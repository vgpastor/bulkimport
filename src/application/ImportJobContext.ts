import type { Batch } from '../domain/model/Batch.js';
import type { ImportStatus } from '../domain/model/ImportStatus.js';
import type { ImportProgress, ImportSummary, ImportJobState } from '../domain/model/ImportJob.js';
import type { SchemaDefinition } from '../domain/model/Schema.js';
import type { DataSource } from '../domain/ports/DataSource.js';
import type { SourceParser } from '../domain/ports/SourceParser.js';
import type { StateStore } from '../domain/ports/StateStore.js';
import { canTransition } from '../domain/model/ImportStatus.js';
import { SchemaValidator } from '../domain/services/SchemaValidator.js';
import { EventBus } from './EventBus.js';

/**
 * Mutable state holder shared across all use cases within a single import job.
 *
 * This is an internal class — not exported from the public API. It centralises
 * the state that was previously scattered across private fields in `BulkImport`.
 * Use cases receive a reference to this context and mutate it as processing
 * progresses.
 */
export class ImportJobContext {
  readonly validator: SchemaValidator;
  readonly eventBus: EventBus;
  readonly stateStore: StateStore;
  readonly batchSize: number;
  readonly continueOnError: boolean;
  readonly maxConcurrentBatches: number;
  readonly schema: SchemaDefinition;

  source: DataSource | null = null;
  parser: SourceParser | null = null;

  jobId: string;
  status: ImportStatus = 'CREATED';
  batches: Batch[] = [];
  batchIndexById = new Map<string, number>();
  totalRecords = 0;
  processedCount = 0;
  failedCount = 0;
  seenUniqueValues = new Map<string, Set<unknown>>();
  startedAt?: number;
  completedBatchIndices = new Set<number>();

  abortController: AbortController | null = null;
  pausePromise: { resolve: () => void; promise: Promise<void> } | null = null;

  constructor(
    schema: SchemaDefinition,
    batchSize: number,
    continueOnError: boolean,
    maxConcurrentBatches: number,
    stateStore: StateStore,
  ) {
    this.schema = schema;
    this.batchSize = batchSize;
    this.continueOnError = continueOnError;
    this.maxConcurrentBatches = maxConcurrentBatches;
    this.stateStore = stateStore;
    this.validator = new SchemaValidator(schema);
    this.eventBus = new EventBus();
    this.jobId = crypto.randomUUID();
  }

  transitionTo(newStatus: ImportStatus): void {
    if (!canTransition(this.status, newStatus)) {
      throw new Error(`Invalid state transition: ${this.status} → ${newStatus}`);
    }
    this.status = newStatus;
  }

  buildProgress(): ImportProgress {
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

  buildSummary(): ImportSummary {
    const processed = this.processedCount;
    const failed = this.failedCount;
    const skipped = Math.max(0, this.totalRecords - processed - failed);
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;

    return { total: this.totalRecords, processed, failed, skipped, elapsedMs: elapsed };
  }

  async saveState(): Promise<void> {
    const state: ImportJobState = {
      id: this.jobId,
      config: {
        schema: this.schema,
        batchSize: this.batchSize,
        continueOnError: this.continueOnError,
      },
      status: this.status,
      batches: this.batches,
      totalRecords: this.totalRecords,
      startedAt: this.startedAt,
    };
    await this.stateStore.saveJobState(state);
  }

  async checkPause(): Promise<void> {
    if (this.pausePromise) {
      await this.pausePromise.promise;
    }
  }

  createPausePromise(): { resolve: () => void; promise: Promise<void> } {
    let resolveRef!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveRef = resolve;
    });
    return { resolve: resolveRef, promise };
  }

  assertSourceConfigured(): void {
    if (!this.source || !this.parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }
  }

  updateBatchStatus(batchId: string, status: Batch['status'], processedCount?: number, failedCount?: number): void {
    const pos = this.batchIndexById.get(batchId);
    if (pos === undefined) return;
    const batch = this.batches[pos];
    if (!batch) return;
    this.batches[pos] = {
      ...batch,
      status,
      processedCount: processedCount ?? batch.processedCount,
      failedCount: failedCount ?? batch.failedCount,
    };
  }
}
