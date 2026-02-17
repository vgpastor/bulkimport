import type {
  StateStore,
  DistributedStateStore,
  SchemaDefinition,
  ProcessedRecord,
  RecordProcessorFn,
  ProcessingContext,
  HookContext,
  ImportHooks,
  DuplicateChecker,
  ValidationError,
} from '@bulkimport/core';
import type { EventBus } from '@bulkimport/core';
import {
  SchemaValidator,
  markRecordValid,
  markRecordInvalid,
  markRecordFailed,
  hasErrors,
  getWarnings,
  isDistributedStateStore,
} from '@bulkimport/core';

/** Result of processing a single distributed batch. */
export interface DistributedBatchResult {
  /** Whether a batch was successfully claimed. */
  readonly claimed: boolean;
  /** Batch ID that was processed (only if claimed). */
  readonly batchId?: string;
  /** Batch index that was processed (only if claimed). */
  readonly batchIndex?: number;
  /** Records successfully processed in this batch. */
  readonly processedCount: number;
  /** Records that failed in this batch. */
  readonly failedCount: number;
  /** Whether this worker finalized the entire job. */
  readonly jobComplete: boolean;
  /** The job identifier. */
  readonly jobId: string;
}

/** Configuration for the distributed batch processor. */
export interface DistributedBatchConfig {
  readonly schema: SchemaDefinition;
  readonly stateStore: StateStore;
  readonly continueOnError?: boolean;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly hooks?: ImportHooks;
  readonly duplicateChecker?: DuplicateChecker;
}

/**
 * Phase 2 of distributed processing: claim and process a single batch.
 *
 * Each worker creates an instance and calls `execute()` in a loop until
 * no more batches are available (`claimed: false`) or the job is complete.
 */
export class ProcessDistributedBatch {
  private readonly stateStore: DistributedStateStore;
  private readonly validator: SchemaValidator;
  private readonly eventBus: EventBus;
  private readonly continueOnError: boolean;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly hooks: ImportHooks | null;
  private readonly duplicateChecker: DuplicateChecker | null;

  constructor(
    private readonly config: DistributedBatchConfig,
    eventBus: EventBus,
  ) {
    if (!isDistributedStateStore(config.stateStore)) {
      throw new Error('Distributed processing requires a DistributedStateStore implementation.');
    }
    this.stateStore = config.stateStore;
    this.validator = new SchemaValidator(config.schema);
    this.eventBus = eventBus;
    this.continueOnError = config.continueOnError ?? true;
    this.maxRetries = config.maxRetries ?? 0;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.hooks = config.hooks ?? null;
    this.duplicateChecker = config.duplicateChecker ?? null;
  }

  async execute(jobId: string, processor: RecordProcessorFn, workerId: string): Promise<DistributedBatchResult> {
    const claimResult = await this.stateStore.claimBatch(jobId, workerId);

    if (!claimResult.claimed) {
      return {
        claimed: false,
        processedCount: 0,
        failedCount: 0,
        jobComplete: false,
        jobId,
      };
    }

    const { reservation } = claimResult;
    const { batchId, batchIndex } = reservation;

    this.eventBus.emit({
      type: 'batch:claimed',
      jobId,
      batchId,
      batchIndex,
      workerId,
      timestamp: Date.now(),
    });

    const records = await this.stateStore.getBatchRecords(jobId, batchId);

    this.eventBus.emit({
      type: 'batch:started',
      jobId,
      batchId,
      batchIndex,
      recordCount: records.length,
      timestamp: Date.now(),
    });

    let processedCount = 0;
    let failedCount = 0;
    let batchFailed = false;

    try {
      for (const record of records) {
        if (this.validator.skipEmptyRows && this.validator.isEmptyRow(record.raw)) {
          continue;
        }

        const hookCtx: HookContext = {
          jobId,
          batchId,
          batchIndex,
          recordIndex: record.index,
          totalRecords: records.length,
          signal: new AbortController().signal,
        };

        // --- beforeValidate hook ---
        let aliased = this.validator.resolveAliases(record.raw);
        if (this.hooks?.beforeValidate) {
          try {
            aliased = await this.hooks.beforeValidate(aliased, hookCtx);
          } catch (hookError) {
            const errorMsg = hookError instanceof Error ? hookError.message : String(hookError);
            await this.handleRecordFailure(record, jobId, batchId, `beforeValidate hook failed: ${errorMsg}`);
            failedCount++;
            if (!this.continueOnError) throw new Error(errorMsg);
            continue;
          }
        }

        // --- Validation ---
        const transformed = this.validator.applyTransforms(aliased);
        const validation = this.validator.validate(transformed);

        // Note: in distributed mode, in-memory uniqueness is skipped.
        // Use DuplicateChecker for cross-worker duplicate detection.

        // --- External duplicate check ---
        const externalDupErrors: ValidationError[] = [];
        if (this.duplicateChecker && validation.errors.length === 0) {
          try {
            const dupResult = await this.duplicateChecker.check(transformed, hookCtx);
            if (dupResult.isDuplicate) {
              externalDupErrors.push({
                field: '_external',
                message: `Duplicate record found${dupResult.existingId ? ` (existing ID: ${dupResult.existingId})` : ''}`,
                code: 'EXTERNAL_DUPLICATE',
                value: undefined,
              });
            }
          } catch (checkerError) {
            const errorMsg = checkerError instanceof Error ? checkerError.message : String(checkerError);
            externalDupErrors.push({
              field: '_external',
              message: `Duplicate check failed: ${errorMsg}`,
              code: 'EXTERNAL_DUPLICATE',
              value: undefined,
            });
          }
        }

        let allErrors = [...validation.errors, ...externalDupErrors];

        // --- afterValidate hook ---
        if (this.hooks?.afterValidate) {
          try {
            const tempRecord =
              allErrors.length > 0 ? markRecordInvalid(record, allErrors) : markRecordValid(record, transformed);
            const modifiedRecord = await this.hooks.afterValidate(tempRecord, hookCtx);
            allErrors = [...modifiedRecord.errors];
          } catch (hookError) {
            const errorMsg = hookError instanceof Error ? hookError.message : String(hookError);
            await this.handleRecordFailure(record, jobId, batchId, `afterValidate hook failed: ${errorMsg}`);
            failedCount++;
            if (!this.continueOnError) throw new Error(errorMsg);
            continue;
          }
        }

        // --- Validation result ---
        if (hasErrors(allErrors)) {
          const invalidRecord = markRecordInvalid(record, allErrors);
          failedCount++;
          await this.stateStore.saveProcessedRecord(jobId, batchId, invalidRecord);
          this.eventBus.emit({
            type: 'record:failed',
            jobId,
            batchId,
            recordIndex: record.index,
            error: allErrors.map((e) => e.message).join('; '),
            record: invalidRecord,
            timestamp: Date.now(),
          });
          if (!this.continueOnError) throw new Error(`Validation failed for record ${String(record.index)}`);
          continue;
        }

        // --- Warnings (non-blocking) ---
        const warnings = getWarnings(allErrors);
        const validRecord = markRecordValid(record, transformed, warnings.length > 0 ? warnings : undefined);
        const context: ProcessingContext = {
          jobId,
          batchId,
          batchIndex,
          recordIndex: record.index,
          totalRecords: records.length,
          signal: new AbortController().signal,
        };

        // --- beforeProcess hook ---
        let parsedForProcessor = validRecord.parsed;
        if (this.hooks?.beforeProcess) {
          try {
            parsedForProcessor = await this.hooks.beforeProcess(parsedForProcessor, hookCtx);
          } catch (hookError) {
            const errorMsg = hookError instanceof Error ? hookError.message : String(hookError);
            await this.handleRecordFailure(record, jobId, batchId, `beforeProcess hook failed: ${errorMsg}`);
            failedCount++;
            if (!this.continueOnError) throw new Error(errorMsg);
            continue;
          }
        }

        // --- Process with retry ---
        const recordForProcessor: ProcessedRecord = { ...validRecord, parsed: parsedForProcessor };
        const result = await this.executeWithRetry(recordForProcessor, context, processor, jobId, batchId);

        if (result.success) {
          processedCount++;
          const processedRecord: ProcessedRecord = {
            ...recordForProcessor,
            status: 'processed',
            retryCount: result.attempts - 1,
          };
          await this.stateStore.saveProcessedRecord(jobId, batchId, processedRecord);
          this.eventBus.emit({
            type: 'record:processed',
            jobId,
            batchId,
            recordIndex: record.index,
            timestamp: Date.now(),
          });

          // --- afterProcess hook ---
          if (this.hooks?.afterProcess) {
            try {
              await this.hooks.afterProcess(processedRecord, hookCtx);
            } catch (hookError) {
              const errorMsg = hookError instanceof Error ? hookError.message : String(hookError);
              processedCount--;
              const failedAfterHook = markRecordFailed(recordForProcessor, `afterProcess hook failed: ${errorMsg}`);
              failedCount++;
              await this.stateStore.saveProcessedRecord(jobId, batchId, failedAfterHook);
              this.eventBus.emit({
                type: 'record:failed',
                jobId,
                batchId,
                recordIndex: record.index,
                error: errorMsg,
                record: failedAfterHook,
                timestamp: Date.now(),
              });
              if (!this.continueOnError) throw new Error(errorMsg);
            }
          }
        } else {
          const failedRecord = markRecordFailed(validRecord, result.error);
          const failedWithRetries: ProcessedRecord = { ...failedRecord, retryCount: result.attempts - 1 };
          failedCount++;
          await this.stateStore.saveProcessedRecord(jobId, batchId, failedWithRetries);
          this.eventBus.emit({
            type: 'record:failed',
            jobId,
            batchId,
            recordIndex: record.index,
            error: result.error,
            record: failedWithRetries,
            timestamp: Date.now(),
          });
          if (!this.continueOnError) throw new Error(result.error);
        }
      }
    } catch {
      batchFailed = true;
    }

    // Update batch state
    const batchStatus = batchFailed ? 'FAILED' : 'COMPLETED';
    await this.stateStore.updateBatchState(jobId, batchId, {
      batchId,
      status: batchStatus,
      processedCount,
      failedCount,
    });

    if (batchFailed) {
      this.eventBus.emit({
        type: 'batch:failed',
        jobId,
        batchId,
        batchIndex,
        error: `Batch failed with ${String(failedCount)} errors`,
        timestamp: Date.now(),
      });
    } else {
      this.eventBus.emit({
        type: 'batch:completed',
        jobId,
        batchId,
        batchIndex,
        processedCount,
        failedCount,
        totalCount: records.length,
        timestamp: Date.now(),
      });
    }

    // Try to finalize the job (exactly-once)
    const jobComplete = await this.stateStore.tryFinalizeJob(jobId);

    if (jobComplete) {
      const status = await this.stateStore.getDistributedStatus(jobId);
      this.eventBus.emit({
        type: 'import:completed',
        jobId,
        summary: {
          total: status.totalBatches,
          processed: status.completedBatches,
          failed: status.failedBatches,
          skipped: 0,
          elapsedMs: 0,
        },
        timestamp: Date.now(),
      });
    }

    return {
      claimed: true,
      batchId,
      batchIndex,
      processedCount,
      failedCount,
      jobComplete,
      jobId,
    };
  }

  private async executeWithRetry(
    validRecord: ProcessedRecord,
    context: ProcessingContext,
    processor: RecordProcessorFn,
    jobId: string,
    batchId: string,
  ): Promise<{ success: true; attempts: number } | { success: false; attempts: number; error: string }> {
    const maxAttempts = 1 + this.maxRetries;
    let lastError = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await processor(validRecord.parsed, context);
        return { success: true, attempts: attempt };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        if (attempt < maxAttempts) {
          this.eventBus.emit({
            type: 'record:retried',
            jobId,
            batchId,
            recordIndex: validRecord.index,
            attempt,
            maxRetries: this.maxRetries,
            error: lastError,
            timestamp: Date.now(),
          });

          const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    return { success: false, attempts: maxAttempts, error: lastError };
  }

  private async handleRecordFailure(
    record: ProcessedRecord,
    jobId: string,
    batchId: string,
    errorMsg: string,
  ): Promise<void> {
    const failedRecord = markRecordFailed(record, errorMsg);
    await this.stateStore.saveProcessedRecord(jobId, batchId, failedRecord);
    this.eventBus.emit({
      type: 'record:failed',
      jobId,
      batchId,
      recordIndex: record.index,
      error: errorMsg,
      record: failedRecord,
      timestamp: Date.now(),
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
