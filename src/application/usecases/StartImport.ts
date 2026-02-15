import type { ProcessedRecord } from '../../domain/model/Record.js';
import type { DataSource } from '../../domain/ports/DataSource.js';
import type { SourceParser } from '../../domain/ports/SourceParser.js';
import type { RecordProcessorFn, ProcessingContext } from '../../domain/ports/RecordProcessor.js';
import { createPendingRecord, markRecordValid, markRecordInvalid, markRecordFailed } from '../../domain/model/Record.js';
import { createBatch, clearBatchRecords } from '../../domain/model/Batch.js';
import { BatchSplitter } from '../../domain/services/BatchSplitter.js';
import type { ImportJobContext } from '../ImportJobContext.js';

/** Use case: process all records through the provided callback. */
export class StartImport {
  constructor(private readonly ctx: ImportJobContext) {}

  async execute(processor: RecordProcessorFn): Promise<void> {
    this.ctx.assertSourceConfigured();
    this.assertCanStart();

    this.ctx.transitionTo('PROCESSING');
    this.ctx.abortController = new AbortController();
    this.ctx.startedAt = this.ctx.startedAt ?? Date.now();

    if (this.ctx.completedBatchIndices.size === 0) {
      this.ctx.processedCount = 0;
      this.ctx.failedCount = 0;
      this.ctx.seenUniqueValues = new Map();
      this.ctx.batches = [];
      this.ctx.batchIndexById = new Map();
      this.ctx.totalRecords = 0;
    }

    const source = this.ctx.source;
    const parser = this.ctx.parser;
    if (!source || !parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }

    this.ctx.eventBus.emit({
      type: 'import:started',
      jobId: this.ctx.jobId,
      totalRecords: this.ctx.totalRecords,
      totalBatches: this.ctx.batches.length,
      timestamp: Date.now(),
    });

    try {
      if (this.ctx.maxConcurrentBatches > 1) {
        await this.processWithConcurrency(source, parser, processor);
      } else {
        await this.processSequentially(source, parser, processor);
      }

      if (!this.ctx.abortController.signal.aborted && this.ctx.status !== 'ABORTED') {
        this.ctx.transitionTo('COMPLETED');
        const summary = this.ctx.buildSummary();

        this.ctx.eventBus.emit({
          type: 'import:completed',
          jobId: this.ctx.jobId,
          summary,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      if (this.ctx.status !== 'ABORTED') {
        this.ctx.transitionTo('FAILED');
        this.ctx.eventBus.emit({
          type: 'import:failed',
          jobId: this.ctx.jobId,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }
    }

    await this.ctx.saveState();
  }

  private assertCanStart(): void {
    if (this.ctx.status !== 'PREVIEWED' && this.ctx.status !== 'CREATED') {
      throw new Error(`Cannot start import from status '${this.ctx.status}'`);
    }
  }

  private async *streamRecords(source: DataSource, parser: SourceParser): AsyncIterable<ProcessedRecord> {
    let recordIndex = this.ctx.totalRecords;

    for await (const chunk of source.read()) {
      for await (const raw of parser.parse(chunk)) {
        if (this.ctx.abortController?.signal.aborted) return;
        await this.ctx.checkPause();

        yield createPendingRecord(recordIndex, raw);
        recordIndex++;
        this.ctx.totalRecords = recordIndex;
      }
      if (this.ctx.abortController?.signal.aborted) return;
    }
  }

  private async processSequentially(
    source: DataSource,
    parser: SourceParser,
    processor: RecordProcessorFn,
  ): Promise<void> {
    const splitter = new BatchSplitter(this.ctx.batchSize);

    for await (const { records, batchIndex } of splitter.split(this.streamRecords(source, parser))) {
      if (this.ctx.abortController?.signal.aborted || this.ctx.status === 'ABORTED') break;
      if (!this.ctx.completedBatchIndices.has(batchIndex)) {
        await this.processStreamBatch(records, batchIndex, processor);
      }
    }
  }

  private async processWithConcurrency(
    source: DataSource,
    parser: SourceParser,
    processor: RecordProcessorFn,
  ): Promise<void> {
    const maxConcurrency = this.ctx.maxConcurrentBatches;
    const splitter = new BatchSplitter(this.ctx.batchSize);
    const activeBatches = new Set<Promise<void>>();

    for await (const { records, batchIndex } of splitter.split(this.streamRecords(source, parser))) {
      if (this.ctx.abortController?.signal.aborted || this.ctx.status === 'ABORTED') break;
      if (this.ctx.completedBatchIndices.has(batchIndex)) continue;

      while (activeBatches.size >= maxConcurrency) {
        await Promise.race(activeBatches);
      }

      const batchPromise: Promise<void> = this.processStreamBatch(records, batchIndex, processor).then(() => {
        activeBatches.delete(batchPromise);
      });
      activeBatches.add(batchPromise);
    }

    await Promise.all([...activeBatches]);
  }

  private async processStreamBatch(
    records: readonly ProcessedRecord[],
    batchIndex: number,
    processor: RecordProcessorFn,
  ): Promise<void> {
    const batchId = crypto.randomUUID();
    const batch = createBatch(batchId, batchIndex, records);
    this.ctx.batchIndexById.set(batchId, this.ctx.batches.length);
    this.ctx.batches.push(batch);

    this.ctx.updateBatchStatus(batchId, 'PROCESSING');
    await this.ctx.stateStore.updateBatchState(this.ctx.jobId, batchId, {
      batchId,
      status: 'PROCESSING',
      processedCount: 0,
      failedCount: 0,
    });

    this.ctx.eventBus.emit({
      type: 'batch:started',
      jobId: this.ctx.jobId,
      batchId,
      batchIndex,
      recordCount: records.length,
      timestamp: Date.now(),
    });

    let processedCount = 0;
    let failedCount = 0;

    for (const record of records) {
      if (this.ctx.abortController?.signal.aborted) break;
      await this.ctx.checkPause();

      if (this.ctx.validator.skipEmptyRows && this.ctx.validator.isEmptyRow(record.raw)) {
        continue;
      }

      const aliased = this.ctx.validator.resolveAliases(record.raw);
      const transformed = this.ctx.validator.applyTransforms(aliased);
      const validation = this.ctx.validator.validate(transformed);

      const uniqueErrors = this.ctx.validator.hasUniqueFields
        ? this.ctx.validator.validateUniqueness(transformed, this.ctx.seenUniqueValues)
        : [];

      const allErrors = [...validation.errors, ...uniqueErrors];

      if (allErrors.length > 0) {
        const invalidRecord = markRecordInvalid(record, allErrors);
        this.ctx.failedCount++;
        failedCount++;

        await this.ctx.stateStore.saveProcessedRecord(this.ctx.jobId, batchId, invalidRecord);

        this.ctx.eventBus.emit({
          type: 'record:failed',
          jobId: this.ctx.jobId,
          batchId,
          recordIndex: record.index,
          error: allErrors.map((e) => e.message).join('; '),
          record: invalidRecord,
          timestamp: Date.now(),
        });

        if (!this.ctx.continueOnError) {
          throw new Error(`Validation failed for record ${String(record.index)}`);
        }
        continue;
      }

      const validRecord = markRecordValid(record, transformed);

      try {
        const context: ProcessingContext = {
          jobId: this.ctx.jobId,
          batchId,
          batchIndex,
          recordIndex: record.index,
          totalRecords: this.ctx.totalRecords,
          signal: this.ctx.abortController?.signal ?? new AbortController().signal,
        };

        await processor(validRecord.parsed, context);

        this.ctx.processedCount++;
        processedCount++;

        await this.ctx.stateStore.saveProcessedRecord(this.ctx.jobId, batchId, {
          ...validRecord,
          status: 'processed',
        });

        this.ctx.eventBus.emit({
          type: 'record:processed',
          jobId: this.ctx.jobId,
          batchId,
          recordIndex: record.index,
          timestamp: Date.now(),
        });
      } catch (error) {
        const failedRecord = markRecordFailed(validRecord, error instanceof Error ? error.message : String(error));
        this.ctx.failedCount++;
        failedCount++;

        await this.ctx.stateStore.saveProcessedRecord(this.ctx.jobId, batchId, failedRecord);

        this.ctx.eventBus.emit({
          type: 'record:failed',
          jobId: this.ctx.jobId,
          batchId,
          recordIndex: record.index,
          error: error instanceof Error ? error.message : String(error),
          record: failedRecord,
          timestamp: Date.now(),
        });

        if (!this.ctx.continueOnError) {
          throw error;
        }
      }
    }

    this.ctx.updateBatchStatus(batchId, 'COMPLETED', processedCount, failedCount);
    this.ctx.completedBatchIndices.add(batchIndex);

    await this.ctx.stateStore.updateBatchState(this.ctx.jobId, batchId, {
      batchId,
      status: 'COMPLETED',
      processedCount,
      failedCount,
    });

    const batchPos = this.ctx.batchIndexById.get(batchId);
    if (batchPos !== undefined) {
      const currentBatch = this.ctx.batches[batchPos];
      if (currentBatch) {
        this.ctx.batches[batchPos] = clearBatchRecords(currentBatch);
      }
    }

    this.ctx.eventBus.emit({
      type: 'batch:completed',
      jobId: this.ctx.jobId,
      batchId,
      batchIndex,
      processedCount,
      failedCount,
      totalCount: records.length,
      timestamp: Date.now(),
    });

    this.ctx.eventBus.emit({
      type: 'import:progress',
      jobId: this.ctx.jobId,
      progress: this.ctx.buildProgress(),
      timestamp: Date.now(),
    });

    await this.ctx.saveState();
  }
}
