import type { Batch } from '../domain/model/Batch.js';
import type { JobStatus } from '../domain/model/JobStatus.js';
import type { JobProgress, JobSummary, JobState } from '../domain/model/Job.js';
import type { RawRecord } from '../domain/model/Record.js';
import type { ValidationResult } from '../domain/model/ValidationResult.js';
import type { DataSource } from '../domain/ports/DataSource.js';
import type { StateStore } from '../domain/ports/StateStore.js';
import type { JobHooks } from '../domain/ports/JobHooks.js';
import { canTransition } from '../domain/model/JobStatus.js';
import { isEmptyRow } from '../domain/model/Record.js';
import { EventBus } from './EventBus.js';

/** Function that validates a record and returns a validation result. */
export type ValidateFn = (record: RawRecord) => ValidationResult;

/**
 * Mutable state holder shared across all use cases within a single job.
 *
 * This is an internal class — not exported from the public API. It centralises
 * the state that was previously scattered across private fields in `BatchEngine`.
 * Use cases receive a reference to this context and mutate it as processing
 * progresses.
 */
export class JobContext {
  readonly eventBus: EventBus;
  readonly stateStore: StateStore;
  readonly batchSize: number;
  readonly continueOnError: boolean;
  readonly maxConcurrentBatches: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly hooks: JobHooks | null;
  readonly validate: ValidateFn | null;
  readonly skipEmptyRows: boolean;

  source: DataSource | null = null;
  parser: { parse(data: string | Buffer): AsyncIterable<RawRecord> | Iterable<RawRecord> } | null = null;

  jobId: string;
  status: JobStatus = 'CREATED';
  batches: Batch[] = [];
  batchIndexById = new Map<string, number>();
  totalRecords = 0;
  processedCount = 0;
  failedCount = 0;
  startedAt?: number;
  completedBatchIndices = new Set<number>();

  abortController: AbortController | null = null;
  pausePromise: { resolve: () => void; promise: Promise<void> } | null = null;

  /** Chunk processing limits (set by ProcessChunk use case). */
  chunkLimits: { readonly maxRecords?: number; readonly maxDurationMs?: number } | null = null;
  /** Timestamp when the current chunk started processing. */
  chunkStartTime: number | null = null;
  /** Number of records processed (success + fail) in the current chunk. */
  chunkRecordCount = 0;
  /** Whether the current chunk has reached its limits. */
  chunkExhausted = false;

  constructor(
    batchSize: number,
    continueOnError: boolean,
    maxConcurrentBatches: number,
    stateStore: StateStore,
    maxRetries: number,
    retryDelayMs: number,
    hooks?: JobHooks | null,
    validate?: ValidateFn | null,
    skipEmptyRows?: boolean,
  ) {
    this.batchSize = batchSize;
    this.continueOnError = continueOnError;
    this.maxConcurrentBatches = maxConcurrentBatches;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.stateStore = stateStore;
    this.hooks = hooks ?? null;
    this.validate = validate ?? null;
    this.skipEmptyRows = skipEmptyRows ?? false;
    this.eventBus = new EventBus();
    this.jobId = crypto.randomUUID();
  }

  transitionTo(newStatus: JobStatus): void {
    if (!canTransition(this.status, newStatus)) {
      throw new Error(`Invalid state transition: ${this.status} → ${newStatus}`);
    }
    this.status = newStatus;
  }

  buildProgress(): JobProgress {
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

  buildSummary(): JobSummary {
    const processed = this.processedCount;
    const failed = this.failedCount;
    const skipped = Math.max(0, this.totalRecords - processed - failed);
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;

    return { total: this.totalRecords, processed, failed, skipped, elapsedMs: elapsed };
  }

  async saveState(): Promise<void> {
    const state: JobState = {
      id: this.jobId,
      config: {
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

  /** Check whether a raw record has all empty values. */
  isEmptyRow(record: RawRecord): boolean {
    return isEmptyRow(record);
  }

  /** Check whether the current chunk has exceeded its time or record limits. */
  isChunkExhausted(): boolean {
    if (!this.chunkLimits) return false;

    if (this.chunkLimits.maxRecords !== undefined && this.chunkRecordCount >= this.chunkLimits.maxRecords) {
      return true;
    }

    if (
      this.chunkLimits.maxDurationMs !== undefined &&
      this.chunkStartTime !== null &&
      Date.now() - this.chunkStartTime >= this.chunkLimits.maxDurationMs
    ) {
      return true;
    }

    return false;
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
