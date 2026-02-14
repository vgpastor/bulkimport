import type { SchemaDefinition } from './domain/model/Schema.js';
import type { ImportJobState, ImportProgress, ImportSummary, PreviewResult } from './domain/model/ImportJob.js';
import type { ProcessedRecord } from './domain/model/Record.js';
import type { Batch } from './domain/model/Batch.js';
import type { ImportStatus } from './domain/model/ImportStatus.js';
import type { SourceParser } from './domain/ports/SourceParser.js';
import type { DataSource } from './domain/ports/DataSource.js';
import type { StateStore } from './domain/ports/StateStore.js';
import type { RecordProcessorFn, ProcessingContext } from './domain/ports/RecordProcessor.js';
import type { EventType, EventPayload } from './domain/events/DomainEvents.js';
import { canTransition } from './domain/model/ImportStatus.js';
import { createBatch, clearBatchRecords } from './domain/model/Batch.js';
import { createPendingRecord, markRecordValid, markRecordInvalid, markRecordFailed } from './domain/model/Record.js';
import { SchemaValidator } from './domain/services/SchemaValidator.js';
import { EventBus } from './application/EventBus.js';
import { InMemoryStateStore } from './infrastructure/state/InMemoryStateStore.js';

export interface BulkImportConfig {
  readonly schema: SchemaDefinition;
  readonly batchSize?: number;
  readonly maxConcurrentBatches?: number;
  readonly continueOnError?: boolean;
  readonly stateStore?: StateStore;
}

export class BulkImport {
  private readonly config: Required<Pick<BulkImportConfig, 'batchSize' | 'continueOnError'>> & BulkImportConfig;
  private readonly validator: SchemaValidator;
  private readonly eventBus: EventBus;
  private readonly stateStore: StateStore;

  private source: DataSource | null = null;
  private parser: SourceParser | null = null;

  private jobId: string;
  private status: ImportStatus = 'CREATED';
  private batches: Batch[] = [];
  private totalRecords = 0;
  private processedCount = 0;
  private failedCount = 0;
  private failedRecordsAccum: ProcessedRecord[] = [];
  private seenUniqueValues = new Map<string, Set<unknown>>();
  private startedAt?: number;

  private abortController: AbortController | null = null;
  private pausePromise: { resolve: () => void; promise: Promise<void> } | null = null;

  constructor(config: BulkImportConfig) {
    this.config = {
      ...config,
      batchSize: config.batchSize ?? 100,
      continueOnError: config.continueOnError ?? false,
    };
    this.validator = new SchemaValidator(config.schema);
    this.eventBus = new EventBus();
    this.stateStore = config.stateStore ?? new InMemoryStateStore();
    this.jobId = crypto.randomUUID();
  }

  from(source: DataSource, parser: SourceParser): this {
    this.source = source;
    this.parser = parser;
    return this;
  }

  on<T extends EventType>(type: T, handler: (event: EventPayload<T>) => void): this {
    this.eventBus.on(type, handler);
    return this;
  }

  async preview(maxRecords = 10): Promise<PreviewResult> {
    this.assertSourceConfigured();
    this.transitionTo('PREVIEWING');

    const records = await this.parseRecords(maxRecords);
    const validRecords: ProcessedRecord[] = [];
    const invalidRecords: ProcessedRecord[] = [];
    const columns = new Set<string>();

    for (const record of records) {
      if (this.validator.skipEmptyRows && this.validator.isEmptyRow(record.raw)) {
        continue;
      }
      const aliased = this.validator.resolveAliases(record.raw);
      for (const key of Object.keys(aliased)) {
        columns.add(key);
      }
      const transformed = this.validator.applyTransforms(aliased);
      const result = this.validator.validate(transformed);

      if (result.isValid) {
        validRecords.push(markRecordValid(record, transformed));
      } else {
        invalidRecords.push(markRecordInvalid(record, result.errors));
      }
    }

    this.transitionTo('PREVIEWED');

    return {
      validRecords,
      invalidRecords,
      totalSampled: records.length,
      columns: [...columns],
    };
  }

  async start(processor: RecordProcessorFn): Promise<void> {
    this.assertSourceConfigured();
    this.assertCanStart();

    this.transitionTo('PROCESSING');
    this.abortController = new AbortController();
    this.startedAt = Date.now();

    this.processedCount = 0;
    this.failedCount = 0;
    this.failedRecordsAccum = [];
    this.seenUniqueValues = new Map();
    this.batches = [];
    this.totalRecords = 0;

    const source = this.source;
    const parser = this.parser;
    if (!source || !parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }

    this.eventBus.emit({
      type: 'import:started',
      jobId: this.jobId,
      totalRecords: 0,
      totalBatches: 0,
      timestamp: Date.now(),
    });

    try {
      let batchIndex = 0;
      let recordIndex = 0;
      let batchBuffer: ProcessedRecord[] = [];

      for await (const chunk of source.read()) {
        for await (const raw of parser.parse(chunk)) {
          if (this.abortController.signal.aborted) break;
          await this.checkPause();

          batchBuffer.push(createPendingRecord(recordIndex, raw));
          recordIndex++;
          this.totalRecords = recordIndex;

          if (batchBuffer.length >= this.config.batchSize) {
            await this.processStreamBatch(batchBuffer, batchIndex, processor);
            batchBuffer = [];
            batchIndex++;
          }
        }
        if (this.abortController.signal.aborted) break;
      }

      if (batchBuffer.length > 0 && !this.abortController.signal.aborted && this.status !== 'ABORTED') {
        await this.processStreamBatch(batchBuffer, batchIndex, processor);
      }

      this.totalRecords = recordIndex;

      if (!this.abortController.signal.aborted && this.status !== 'ABORTED') {
        this.transitionTo('COMPLETED');
        const summary = this.buildSummary();

        this.eventBus.emit({
          type: 'import:completed',
          jobId: this.jobId,
          summary,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      if (this.status !== 'ABORTED') {
        this.transitionTo('FAILED');
        this.eventBus.emit({
          type: 'import:failed',
          jobId: this.jobId,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }
    }

    await this.saveState();
  }

  async pause(): Promise<void> {
    if (this.status !== 'PROCESSING') {
      throw new Error(`Cannot pause import from status '${this.status}'`);
    }

    this.transitionTo('PAUSED');
    this.pausePromise = this.createPausePromise();

    const progress = this.buildProgress();
    this.eventBus.emit({
      type: 'import:paused',
      jobId: this.jobId,
      progress,
      timestamp: Date.now(),
    });

    await this.saveState();
  }

  resume(): void {
    if (this.status === 'ABORTED') {
      throw new Error('Cannot resume an aborted import');
    }
    if (this.status !== 'PAUSED') {
      throw new Error(`Cannot resume import from status '${this.status}'`);
    }

    this.transitionTo('PROCESSING');
    if (this.pausePromise) {
      this.pausePromise.resolve();
      this.pausePromise = null;
    }
  }

  async abort(): Promise<void> {
    if (this.status !== 'PROCESSING' && this.status !== 'PAUSED') {
      throw new Error(`Cannot abort import from status '${this.status}'`);
    }

    this.transitionTo('ABORTED');
    this.abortController?.abort();

    if (this.pausePromise) {
      this.pausePromise.resolve();
      this.pausePromise = null;
    }

    const progress = this.buildProgress();
    this.eventBus.emit({
      type: 'import:aborted',
      jobId: this.jobId,
      progress,
      timestamp: Date.now(),
    });

    await this.saveState();
  }

  getStatus(): { state: ImportStatus; progress: ImportProgress; batches: readonly Batch[] } {
    return {
      state: this.status,
      progress: this.buildProgress(),
      batches: this.batches,
    };
  }

  getFailedRecords(): readonly ProcessedRecord[] {
    return this.failedRecordsAccum;
  }

  getPendingRecords(): readonly ProcessedRecord[] {
    return [];
  }

  getJobId(): string {
    return this.jobId;
  }

  // --- Private methods ---

  private async processStreamBatch(
    records: ProcessedRecord[],
    batchIndex: number,
    processor: RecordProcessorFn,
  ): Promise<void> {
    const batchId = crypto.randomUUID();
    const batch = createBatch(batchId, batchIndex, records);
    this.batches.push(batch);

    this.updateBatchStatus(batchId, 'PROCESSING');

    this.eventBus.emit({
      type: 'batch:started',
      jobId: this.jobId,
      batchId,
      batchIndex,
      recordCount: records.length,
      timestamp: Date.now(),
    });

    let processedCount = 0;
    let failedCount = 0;

    for (const record of records) {
      if (this.abortController?.signal.aborted) break;
      await this.checkPause();

      if (this.validator.skipEmptyRows && this.validator.isEmptyRow(record.raw)) {
        continue;
      }

      const aliased = this.validator.resolveAliases(record.raw);
      const transformed = this.validator.applyTransforms(aliased);
      const validation = this.validator.validate(transformed);

      const uniqueErrors = this.validator.hasUniqueFields
        ? this.validator.validateUniqueness(transformed, this.seenUniqueValues)
        : [];

      const allErrors = [...validation.errors, ...uniqueErrors];

      if (allErrors.length > 0) {
        const invalidRecord = markRecordInvalid(record, allErrors);
        this.failedCount++;
        this.failedRecordsAccum.push(invalidRecord);
        failedCount++;

        this.eventBus.emit({
          type: 'record:failed',
          jobId: this.jobId,
          batchId,
          recordIndex: record.index,
          error: allErrors.map((e) => e.message).join('; '),
          record: invalidRecord,
          timestamp: Date.now(),
        });

        if (!this.config.continueOnError) {
          throw new Error(`Validation failed for record ${String(record.index)}`);
        }
        continue;
      }

      const validRecord = markRecordValid(record, transformed);

      try {
        const context: ProcessingContext = {
          jobId: this.jobId,
          batchId,
          batchIndex,
          recordIndex: record.index,
          totalRecords: this.totalRecords,
          signal: this.abortController?.signal ?? new AbortController().signal,
        };

        await processor(validRecord.parsed, context);

        this.processedCount++;
        processedCount++;

        this.eventBus.emit({
          type: 'record:processed',
          jobId: this.jobId,
          batchId,
          recordIndex: record.index,
          timestamp: Date.now(),
        });
      } catch (error) {
        const failedRecord = markRecordFailed(validRecord, error instanceof Error ? error.message : String(error));
        this.failedCount++;
        this.failedRecordsAccum.push(failedRecord);
        failedCount++;

        this.eventBus.emit({
          type: 'record:failed',
          jobId: this.jobId,
          batchId,
          recordIndex: record.index,
          error: error instanceof Error ? error.message : String(error),
          record: failedRecord,
          timestamp: Date.now(),
        });

        if (!this.config.continueOnError) {
          throw error;
        }
      }
    }

    this.updateBatchStatus(batchId, 'COMPLETED', processedCount, failedCount);

    // Clear records from batch to release memory
    const batchPos = this.batches.findIndex((b) => b.id === batchId);
    if (batchPos >= 0) {
      const currentBatch = this.batches[batchPos];
      if (currentBatch) {
        this.batches[batchPos] = clearBatchRecords(currentBatch);
      }
    }

    this.eventBus.emit({
      type: 'batch:completed',
      jobId: this.jobId,
      batchId,
      batchIndex,
      processedCount,
      failedCount,
      totalCount: records.length,
      timestamp: Date.now(),
    });

    this.emitProgress();
  }

  private async parseRecords(maxRecords?: number): Promise<ProcessedRecord[]> {
    const source = this.source;
    const parser = this.parser;
    if (!source || !parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }

    const records: ProcessedRecord[] = [];
    let index = 0;

    for await (const chunk of source.read()) {
      for await (const raw of parser.parse(chunk)) {
        if (maxRecords !== undefined && records.length >= maxRecords) {
          return records;
        }
        records.push(createPendingRecord(index, raw));
        index++;
      }
    }

    return records;
  }

  private updateBatchStatus(batchId: string, status: Batch['status'], processedCount?: number, failedCount?: number): void {
    this.batches = this.batches.map((b) =>
      b.id === batchId
        ? {
            ...b,
            status,
            processedCount: processedCount ?? b.processedCount,
            failedCount: failedCount ?? b.failedCount,
          }
        : b,
    );
  }

  private transitionTo(newStatus: ImportStatus): void {
    if (!canTransition(this.status, newStatus)) {
      throw new Error(`Invalid state transition: ${this.status} → ${newStatus}`);
    }
    this.status = newStatus;
  }

  private buildProgress(): ImportProgress {
    const processed = this.processedCount;
    const failed = this.failedCount;
    const pending = Math.max(0, this.totalRecords - processed - failed);
    const completed = processed + failed;
    const completedBatches = this.batches.filter((b) => b.status === 'COMPLETED').length;
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;

    return {
      totalRecords: this.totalRecords,
      processedRecords: processed,
      failedRecords: failed,
      pendingRecords: pending,
      percentage: this.totalRecords > 0 ? Math.round((completed / this.totalRecords) * 100) : 0,
      currentBatch: completedBatches,
      totalBatches: this.batches.length,
      elapsedMs: elapsed,
    };
  }

  private buildSummary(): ImportSummary {
    const processed = this.processedCount;
    const failed = this.failedCount;
    const skipped = Math.max(0, this.totalRecords - processed - failed);
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;

    return { total: this.totalRecords, processed, failed, skipped, elapsedMs: elapsed };
  }

  private emitProgress(): void {
    this.eventBus.emit({
      type: 'import:progress',
      jobId: this.jobId,
      progress: this.buildProgress(),
      timestamp: Date.now(),
    });
  }

  private async saveState(): Promise<void> {
    const state: ImportJobState = {
      id: this.jobId,
      config: {
        schema: this.config.schema,
        batchSize: this.config.batchSize,
        continueOnError: this.config.continueOnError,
      },
      status: this.status,
      batches: this.batches,
      totalRecords: this.totalRecords,
      startedAt: this.startedAt,
    };
    await this.stateStore.saveJobState(state);
  }

  private async checkPause(): Promise<void> {
    if (this.pausePromise) {
      await this.pausePromise.promise;
    }
  }

  private createPausePromise(): { resolve: () => void; promise: Promise<void> } {
    let resolveRef!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveRef = resolve;
    });
    return { resolve: resolveRef, promise };
  }

  private assertSourceConfigured(): void {
    if (!this.source || !this.parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }
  }

  private assertCanStart(): void {
    if (this.status !== 'PREVIEWED' && this.status !== 'CREATED') {
      throw new Error(`Cannot start import from status '${this.status}'`);
    }
  }
}
