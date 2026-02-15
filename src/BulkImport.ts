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

/** Configuration for a bulk import job. */
export interface BulkImportConfig {
  /** Schema defining field types, validation rules, aliases, and uniqueness constraints. */
  readonly schema: SchemaDefinition;
  /** Number of records per batch. Default: `100`. */
  readonly batchSize?: number;
  /** Maximum number of batches to process concurrently. Default: `1` (sequential). */
  readonly maxConcurrentBatches?: number;
  /** When `true`, processing continues after a record fails validation or processing. Default: `false`. */
  readonly continueOnError?: boolean;
  /** Persistence adapter for job state. Default: `InMemoryStateStore`. */
  readonly stateStore?: StateStore;
}

/**
 * Facade that orchestrates the full import lifecycle: parse → validate → batch → process.
 *
 * @example
 * ```typescript
 * const importer = new BulkImport({ schema: { fields: [...] }, batchSize: 500 });
 * importer.from(new BufferSource(csv), new CsvParser());
 * await importer.start(async (record) => { await db.insert(record); });
 * ```
 */
export class BulkImport {
  private readonly config: Required<Pick<BulkImportConfig, 'batchSize' | 'continueOnError' | 'maxConcurrentBatches'>> &
    BulkImportConfig;
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
  private completedBatchIndices = new Set<number>();

  private abortController: AbortController | null = null;
  private pausePromise: { resolve: () => void; promise: Promise<void> } | null = null;

  constructor(config: BulkImportConfig) {
    this.config = {
      ...config,
      batchSize: config.batchSize ?? 100,
      continueOnError: config.continueOnError ?? false,
      maxConcurrentBatches: config.maxConcurrentBatches ?? 1,
    };
    this.validator = new SchemaValidator(config.schema);
    this.eventBus = new EventBus();
    this.stateStore = config.stateStore ?? new InMemoryStateStore();
    this.jobId = crypto.randomUUID();
  }

  /**
   * Restore an import job from persisted state.
   *
   * Loads the job state from the configured `StateStore` and re-creates a
   * `BulkImport` instance positioned to resume processing. Only batches not
   * yet completed will be re-processed when `start()` is called again.
   *
   * The caller must provide a `BulkImportConfig` with the same schema and a
   * `stateStore` that contains the persisted state. Non-serializable fields
   * (`customValidator`, `transform`, `pattern`) must be re-provided in the
   * schema since they cannot be persisted.
   *
   * @param jobId - The job ID to restore.
   * @param config - Configuration with stateStore that holds the persisted state.
   * @returns A `BulkImport` instance ready to resume, or `null` if the job was not found.
   */
  static async restore(jobId: string, config: BulkImportConfig): Promise<BulkImport | null> {
    const stateStore = config.stateStore ?? new InMemoryStateStore();
    const jobState = await stateStore.getJobState(jobId);

    if (!jobState) return null;

    const instance = new BulkImport(config);
    instance.jobId = jobId;
    instance.status = jobState.status;
    instance.batches = [...jobState.batches];
    instance.totalRecords = jobState.totalRecords;
    instance.startedAt = jobState.startedAt;

    // Rebuild counters from batch data
    for (const batch of jobState.batches) {
      if (batch.status === 'COMPLETED') {
        instance.processedCount += batch.processedCount;
        instance.failedCount += batch.failedCount;
        instance.completedBatchIndices.add(batch.index);
      }
    }

    // Load failed records from state store
    const failedRecords = await stateStore.getFailedRecords(jobId);
    instance.failedRecordsAccum = [...failedRecords];

    // Reset to CREATED so start() can be called
    instance.status = 'CREATED';

    return instance;
  }

  /**
   * Generate a CSV header template from a schema definition.
   *
   * Returns a single CSV line with all field names, useful for letting
   * frontends download a template that stays in sync with the schema.
   */
  static generateTemplate(schema: SchemaDefinition): string {
    return schema.fields.map((f) => f.name).join(',');
  }

  /** Set the data source and parser. Returns `this` for chaining. */
  from(source: DataSource, parser: SourceParser): this {
    this.source = source;
    this.parser = parser;
    return this;
  }

  /** Subscribe to a lifecycle event. Returns `this` for chaining. */
  on<T extends EventType>(type: T, handler: (event: EventPayload<T>) => void): this {
    this.eventBus.on(type, handler);
    return this;
  }

  /**
   * Validate a sample of records without processing them.
   *
   * Alias resolution and transforms are applied before validation.
   * Returns valid/invalid records, total sampled, and detected column names.
   */
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

  /**
   * Begin processing all records through the provided callback.
   *
   * Records are parsed lazily (streamed) and processed batch-by-batch.
   * When `maxConcurrentBatches > 1`, multiple batches are processed in parallel.
   * Memory is released after each batch completes.
   *
   * @throws Error if source/parser not configured or import already started.
   */
  async start(processor: RecordProcessorFn): Promise<void> {
    this.assertSourceConfigured();
    this.assertCanStart();

    this.transitionTo('PROCESSING');
    this.abortController = new AbortController();
    this.startedAt = this.startedAt ?? Date.now();

    // Only reset counters if this is a fresh start (not a restore)
    if (this.completedBatchIndices.size === 0) {
      this.processedCount = 0;
      this.failedCount = 0;
      this.failedRecordsAccum = [];
      this.seenUniqueValues = new Map();
      this.batches = [];
      this.totalRecords = 0;
    }

    const source = this.source;
    const parser = this.parser;
    if (!source || !parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }

    this.eventBus.emit({
      type: 'import:started',
      jobId: this.jobId,
      totalRecords: this.totalRecords,
      totalBatches: this.batches.length,
      timestamp: Date.now(),
    });

    try {
      if (this.config.maxConcurrentBatches > 1) {
        await this.processWithConcurrency(source, parser, processor);
      } else {
        await this.processSequentially(source, parser, processor);
      }

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

  /** Pause processing after the current record completes. */
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

  /** Resume a paused import. */
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

  /** Cancel the import permanently. Terminal state — cannot be resumed. */
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

  /** Get current state, progress counters, and batch details. */
  getStatus(): { state: ImportStatus; progress: ImportProgress; batches: readonly Batch[] } {
    return {
      state: this.status,
      progress: this.buildProgress(),
      batches: this.batches,
    };
  }

  /** Get all records that failed validation or processing. */
  getFailedRecords(): readonly ProcessedRecord[] {
    return this.failedRecordsAccum;
  }

  /** Get records not yet processed. Returns `[]` in streaming mode (records are not retained). */
  getPendingRecords(): readonly ProcessedRecord[] {
    return [];
  }

  /** Get the unique job identifier (UUID). */
  getJobId(): string {
    return this.jobId;
  }

  // --- Sequential processing (maxConcurrentBatches === 1) ---

  private async processSequentially(
    source: DataSource,
    parser: SourceParser,
    processor: RecordProcessorFn,
  ): Promise<void> {
    let batchIndex = 0;
    let recordIndex = this.totalRecords;
    let batchBuffer: ProcessedRecord[] = [];

    for await (const chunk of source.read()) {
      for await (const raw of parser.parse(chunk)) {
        if (this.abortController?.signal.aborted) break;
        await this.checkPause();

        batchBuffer.push(createPendingRecord(recordIndex, raw));
        recordIndex++;
        this.totalRecords = recordIndex;

        if (batchBuffer.length >= this.config.batchSize) {
          if (!this.completedBatchIndices.has(batchIndex)) {
            await this.processStreamBatch(batchBuffer, batchIndex, processor);
          }
          batchBuffer = [];
          batchIndex++;
        }
      }
      if (this.abortController?.signal.aborted) break;
    }

    if (batchBuffer.length > 0 && !this.abortController?.signal.aborted && this.status !== 'ABORTED') {
      if (!this.completedBatchIndices.has(batchIndex)) {
        await this.processStreamBatch(batchBuffer, batchIndex, processor);
      }
    }

    this.totalRecords = recordIndex;
  }

  // --- Concurrent processing (maxConcurrentBatches > 1) ---

  private async processWithConcurrency(
    source: DataSource,
    parser: SourceParser,
    processor: RecordProcessorFn,
  ): Promise<void> {
    const maxConcurrency = this.config.maxConcurrentBatches;
    let batchIndex = 0;
    let recordIndex = this.totalRecords;
    let batchBuffer: ProcessedRecord[] = [];
    const activeBatches: Promise<void>[] = [];

    const enqueueBatch = async (records: ProcessedRecord[], idx: number): Promise<void> => {
      if (this.completedBatchIndices.has(idx)) return;

      // Wait if we've reached the concurrency limit
      while (activeBatches.length >= maxConcurrency) {
        await Promise.race(activeBatches);
      }

      const batchPromise: Promise<void> = this.processStreamBatch(records, idx, processor).then(() => {
        const pos = activeBatches.indexOf(batchPromise);
        if (pos >= 0) void activeBatches.splice(pos, 1);
      });
      activeBatches.push(batchPromise);
    };

    for await (const chunk of source.read()) {
      for await (const raw of parser.parse(chunk)) {
        if (this.abortController?.signal.aborted) break;
        await this.checkPause();

        batchBuffer.push(createPendingRecord(recordIndex, raw));
        recordIndex++;
        this.totalRecords = recordIndex;

        if (batchBuffer.length >= this.config.batchSize) {
          await enqueueBatch(batchBuffer, batchIndex);
          batchBuffer = [];
          batchIndex++;
        }
      }
      if (this.abortController?.signal.aborted) break;
    }

    if (batchBuffer.length > 0 && !this.abortController?.signal.aborted && this.status !== 'ABORTED') {
      await enqueueBatch(batchBuffer, batchIndex);
    }

    // Wait for all remaining batches to complete
    await Promise.all(activeBatches);

    this.totalRecords = recordIndex;
  }

  // --- Batch processing ---

  private async processStreamBatch(
    records: ProcessedRecord[],
    batchIndex: number,
    processor: RecordProcessorFn,
  ): Promise<void> {
    const batchId = crypto.randomUUID();
    const batch = createBatch(batchId, batchIndex, records);
    this.batches.push(batch);

    this.updateBatchStatus(batchId, 'PROCESSING');
    await this.stateStore.updateBatchState(this.jobId, batchId, {
      batchId,
      status: 'PROCESSING',
      processedCount: 0,
      failedCount: 0,
    });

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

        await this.stateStore.saveProcessedRecord(this.jobId, batchId, invalidRecord);

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

        await this.stateStore.saveProcessedRecord(this.jobId, batchId, {
          ...validRecord,
          status: 'processed',
        });

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

        await this.stateStore.saveProcessedRecord(this.jobId, batchId, failedRecord);

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
    this.completedBatchIndices.add(batchIndex);

    await this.stateStore.updateBatchState(this.jobId, batchId, {
      batchId,
      status: 'COMPLETED',
      processedCount,
      failedCount,
    });

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

    // Persist state after each batch for crash recovery
    await this.saveState();
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

  private updateBatchStatus(
    batchId: string,
    status: Batch['status'],
    processedCount?: number,
    failedCount?: number,
  ): void {
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
