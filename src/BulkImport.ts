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
import { createBatch } from './domain/model/Batch.js';
import { createPendingRecord, markRecordValid, markRecordInvalid, markRecordProcessed, markRecordFailed } from './domain/model/Record.js';
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
  private allRecords: ProcessedRecord[] = [];
  private totalRecords = 0;
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
      for (const key of Object.keys(record.raw)) {
        columns.add(key);
      }
      const transformed = this.validator.applyTransforms(record.raw);
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

    const allRawRecords = await this.parseRecords();
    this.totalRecords = allRawRecords.length;

    this.batches = this.splitIntoBatches(allRawRecords);

    await this.saveState();

    this.eventBus.emit({
      type: 'import:started',
      jobId: this.jobId,
      totalRecords: this.totalRecords,
      totalBatches: this.batches.length,
      timestamp: Date.now(),
    });

    try {
      for (let i = 0; i < this.batches.length; i++) {
        if (this.abortController.signal.aborted) break;
        await this.checkPause();

        const batch = this.batches[i];
        if (!batch) break;
        await this.processBatch(batch, processor);
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
    return this.allRecords.filter((r) => r.status === 'failed' || r.status === 'invalid');
  }

  getPendingRecords(): readonly ProcessedRecord[] {
    return this.allRecords.filter((r) => r.status === 'pending' || r.status === 'valid');
  }

  getJobId(): string {
    return this.jobId;
  }

  // --- Private methods ---

  private async processBatch(batch: Batch, processor: RecordProcessorFn): Promise<void> {
    const batchIndex = this.batches.indexOf(batch);

    this.updateBatchStatus(batch.id, 'PROCESSING');

    this.eventBus.emit({
      type: 'batch:started',
      jobId: this.jobId,
      batchId: batch.id,
      batchIndex,
      recordCount: batch.records.length,
      timestamp: Date.now(),
    });

    let processedCount = 0;
    let failedCount = 0;

    for (const record of batch.records) {
      if (this.abortController?.signal.aborted) break;
      await this.checkPause();

      const transformed = this.validator.applyTransforms(record.raw);
      const validation = this.validator.validate(transformed);

      if (!validation.isValid) {
        const invalidRecord = markRecordInvalid(record, validation.errors);
        this.updateRecord(record.index, invalidRecord);
        failedCount++;

        this.eventBus.emit({
          type: 'record:failed',
          jobId: this.jobId,
          batchId: batch.id,
          recordIndex: record.index,
          error: validation.errors.map((e) => e.message).join('; '),
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
          batchId: batch.id,
          batchIndex,
          recordIndex: record.index,
          totalRecords: this.totalRecords,
          signal: this.abortController?.signal ?? new AbortController().signal,
        };

        await processor(validRecord.parsed, context);

        const processed = markRecordProcessed(validRecord);
        this.updateRecord(record.index, processed);
        processedCount++;

        this.eventBus.emit({
          type: 'record:processed',
          jobId: this.jobId,
          batchId: batch.id,
          recordIndex: record.index,
          timestamp: Date.now(),
        });
      } catch (error) {
        const failedRecord = markRecordFailed(validRecord, error instanceof Error ? error.message : String(error));
        this.updateRecord(record.index, failedRecord);
        failedCount++;

        this.eventBus.emit({
          type: 'record:failed',
          jobId: this.jobId,
          batchId: batch.id,
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

    this.updateBatchStatus(batch.id, 'COMPLETED', processedCount, failedCount);

    this.eventBus.emit({
      type: 'batch:completed',
      jobId: this.jobId,
      batchId: batch.id,
      batchIndex,
      processedCount,
      failedCount,
      totalCount: batch.records.length,
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

  private splitIntoBatches(records: ProcessedRecord[]): Batch[] {
    const batches: Batch[] = [];
    const { batchSize } = this.config;

    for (let i = 0; i < records.length; i += batchSize) {
      const batchRecords = records.slice(i, i + batchSize);
      const batchId = crypto.randomUUID();
      batches.push(createBatch(batchId, batches.length, batchRecords));
    }

    this.allRecords = [...records];
    return batches;
  }

  private updateRecord(index: number, record: ProcessedRecord): void {
    const pos = this.allRecords.findIndex((r) => r.index === index);
    if (pos >= 0) {
      this.allRecords[pos] = record;
    }
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
    const processed = this.allRecords.filter((r) => r.status === 'processed').length;
    const failed = this.allRecords.filter((r) => r.status === 'failed' || r.status === 'invalid').length;
    const pending = this.totalRecords - processed - failed;
    const completedBatches = this.batches.filter((b) => b.status === 'COMPLETED').length;
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;

    return {
      totalRecords: this.totalRecords,
      processedRecords: processed,
      failedRecords: failed,
      pendingRecords: pending,
      percentage: this.totalRecords > 0 ? Math.round((processed / this.totalRecords) * 100) : 0,
      currentBatch: completedBatches,
      totalBatches: this.batches.length,
      elapsedMs: elapsed,
    };
  }

  private buildSummary(): ImportSummary {
    const processed = this.allRecords.filter((r) => r.status === 'processed').length;
    const failed = this.allRecords.filter((r) => r.status === 'failed' || r.status === 'invalid').length;
    const skipped = this.totalRecords - processed - failed;
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
