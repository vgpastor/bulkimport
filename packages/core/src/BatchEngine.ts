import type { JobProgress } from './domain/model/Job.js';
import type { ProcessedRecord } from './domain/model/Record.js';
import type { Batch } from './domain/model/Batch.js';
import type { JobStatus } from './domain/model/JobStatus.js';
import type { ValidationResult } from './domain/model/ValidationResult.js';
import type { RawRecord } from './domain/model/Record.js';
import type { DataSource } from './domain/ports/DataSource.js';
import type { StateStore } from './domain/ports/StateStore.js';
import type { RecordProcessorFn } from './domain/ports/RecordProcessor.js';
import type { EventType, EventPayload, DomainEvent } from './domain/events/DomainEvents.js';
import type { JobHooks } from './domain/ports/JobHooks.js';
import { JobContext } from './application/JobContext.js';
import { StartJob } from './application/usecases/StartJob.js';
import { ProcessChunk } from './application/usecases/ProcessChunk.js';
import type { ChunkOptions, ChunkResult } from './application/usecases/ProcessChunk.js';
import { PauseJob } from './application/usecases/PauseJob.js';
import { ResumeJob } from './application/usecases/ResumeJob.js';
import { AbortJob } from './application/usecases/AbortJob.js';
import { GetJobStatus } from './application/usecases/GetJobStatus.js';
import { InMemoryStateStore } from './infrastructure/state/InMemoryStateStore.js';

/** Function that validates a record and returns a validation result. */
export type ValidateFn = (record: RawRecord) => ValidationResult;

/** Configuration for a batch processing job. */
export interface BatchEngineConfig {
  /** Number of records per batch. Default: `100`. */
  readonly batchSize?: number;
  /** Maximum number of batches to process concurrently. Default: `1` (sequential). */
  readonly maxConcurrentBatches?: number;
  /** When `true`, processing continues after a record fails validation or processing. Default: `false`. */
  readonly continueOnError?: boolean;
  /** Persistence adapter for job state. Default: `InMemoryStateStore`. */
  readonly stateStore?: StateStore;
  /**
   * Maximum number of retry attempts for records that fail during processing.
   * Only processor errors are retried — validation failures are never retried.
   * Default: `0` (no retries).
   */
  readonly maxRetries?: number;
  /**
   * Base delay in milliseconds between retry attempts.
   * Uses exponential backoff: `retryDelayMs * 2^(attempt - 1)`.
   * Default: `1000`.
   */
  readonly retryDelayMs?: number;
  /** Lifecycle hooks for intercepting the record processing pipeline. */
  readonly hooks?: JobHooks;
  /**
   * Optional validation function applied to each record before processing.
   * If not provided, all records pass directly to the processor.
   */
  readonly validate?: ValidateFn;
  /** When `true`, rows where all values are empty/null/undefined are silently skipped. Default: `false`. */
  readonly skipEmptyRows?: boolean;
}

/**
 * Facade that orchestrates the full batch processing lifecycle: read → [validate] → batch → process.
 *
 * Delegates each operation to a dedicated use case in `application/usecases/`.
 * Holds the shared `JobContext` that all use cases operate on.
 *
 * @example
 * ```typescript
 * const engine = new BatchEngine({ batchSize: 500, maxConcurrentBatches: 4 });
 * engine.from(new BufferSource(data), myParser);
 * await engine.start(async (record) => { await db.insert(record); });
 * ```
 */
export class BatchEngine {
  private readonly ctx: JobContext;

  constructor(config: BatchEngineConfig = {}) {
    this.ctx = new JobContext(
      config.batchSize ?? 100,
      config.continueOnError ?? false,
      config.maxConcurrentBatches ?? 1,
      config.stateStore ?? new InMemoryStateStore(),
      config.maxRetries ?? 0,
      config.retryDelayMs ?? 1000,
      config.hooks,
      config.validate,
      config.skipEmptyRows,
    );
  }

  /**
   * Restore a job from persisted state.
   *
   * Loads the job state from the configured `StateStore` and re-creates a
   * `BatchEngine` instance positioned to resume processing. Only batches not
   * yet completed will be re-processed when `start()` is called again.
   *
   * @param jobId - The job ID to restore.
   * @param config - Configuration with stateStore that holds the persisted state.
   * @returns A `BatchEngine` instance ready to resume, or `null` if the job was not found.
   */
  static async restore(jobId: string, config: BatchEngineConfig): Promise<BatchEngine | null> {
    const stateStore = config.stateStore ?? new InMemoryStateStore();
    const jobState = await stateStore.getJobState(jobId);

    if (!jobState) return null;

    const instance = new BatchEngine(config);
    instance.ctx.jobId = jobId;
    instance.ctx.status = jobState.status;
    instance.ctx.batches = [...jobState.batches];
    instance.ctx.totalRecords = jobState.totalRecords;
    instance.ctx.startedAt = jobState.startedAt;

    for (const batch of jobState.batches) {
      if (batch.status === 'COMPLETED') {
        instance.ctx.processedCount += batch.processedCount;
        instance.ctx.failedCount += batch.failedCount;
        instance.ctx.completedBatchIndices.add(batch.index);
      }
    }

    // Reset to CREATED so start() can be called
    instance.ctx.status = 'CREATED';

    return instance;
  }

  /** Set the data source and parser. Returns `this` for chaining. */
  from(
    source: DataSource,
    parser: { parse(data: string | Buffer): AsyncIterable<RawRecord> | Iterable<RawRecord> },
  ): this {
    this.ctx.source = source;
    this.ctx.parser = parser;
    return this;
  }

  /** Subscribe to a lifecycle event. Returns `this` for chaining. */
  on<T extends EventType>(type: T, handler: (event: EventPayload<T>) => void): this {
    this.ctx.eventBus.on(type, handler);
    return this;
  }

  /** Subscribe to all events regardless of type. Returns `this` for chaining. */
  onAny(handler: (event: DomainEvent) => void): this {
    this.ctx.eventBus.onAny(handler);
    return this;
  }

  /** Unsubscribe a wildcard handler previously registered with `onAny()`. */
  offAny(handler: (event: DomainEvent) => void): this {
    this.ctx.eventBus.offAny(handler);
    return this;
  }

  /**
   * Count total records in the configured source without processing them.
   *
   * Streams through the entire source and counts records. Does not modify
   * job state — can be called before `start()` to know the total for
   * progress bars. Requires `from()` to be called first.
   *
   * @returns Total number of records in the source.
   */
  async count(): Promise<number> {
    this.ctx.assertSourceConfigured();
    const source = this.ctx.source as DataSource;
    const parser = this.ctx.parser as { parse(data: string | Buffer): AsyncIterable<RawRecord> | Iterable<RawRecord> };
    let total = 0;

    for await (const chunk of source.read()) {
      for await (const _record of parser.parse(chunk)) {
        void _record;
        total++;
      }
    }

    return total;
  }

  /**
   * Begin processing all records through the provided callback.
   *
   * Records are parsed lazily (streamed) and processed batch-by-batch.
   * When `maxConcurrentBatches > 1`, multiple batches are processed in parallel.
   * Memory is released after each batch completes.
   *
   * @throws Error if source/parser not configured or job already started.
   */
  async start(processor: RecordProcessorFn): Promise<void> {
    return new StartJob(this.ctx).execute(processor);
  }

  /**
   * Process a limited chunk of records, then pause and return control.
   *
   * Designed for serverless environments with execution time limits (e.g. Vercel, Lambda).
   * Call `restore()` + `processChunk()` to continue processing in a subsequent invocation.
   * The job completes when `ChunkResult.done` is `true`.
   *
   * Chunk boundaries are at the batch level: the current batch always completes
   * before the chunk stops. Control granularity with `batchSize`.
   *
   * @param processor - Callback invoked for each valid record.
   * @param options - Optional limits for records processed or time elapsed.
   * @returns Chunk result with progress counters and completion flag.
   */
  async processChunk(processor: RecordProcessorFn, options?: ChunkOptions): Promise<ChunkResult> {
    return new ProcessChunk(this.ctx).execute(processor, options);
  }

  /** Pause processing after the current record completes. */
  async pause(): Promise<void> {
    return new PauseJob(this.ctx).execute();
  }

  /** Resume a paused job. */
  resume(): void {
    new ResumeJob(this.ctx).execute();
  }

  /** Cancel the job permanently. Terminal state — cannot be resumed. */
  async abort(): Promise<void> {
    return new AbortJob(this.ctx).execute();
  }

  /**
   * Get current status, progress counters, and batch details.
   *
   * Returns both `status` and `state` (deprecated alias) for backward compatibility.
   */
  getStatus(): {
    status: JobStatus;
    /** @deprecated Use `status` instead. */
    state: JobStatus;
    progress: JobProgress;
    batches: readonly Batch[];
  } {
    return new GetJobStatus(this.ctx).execute();
  }

  /** Get all records that failed validation or processing. Delegates to the configured StateStore. */
  async getFailedRecords(): Promise<readonly ProcessedRecord[]> {
    return new GetJobStatus(this.ctx).getFailedRecords();
  }

  /** Get records not yet processed. Returns `[]` in streaming mode (records are not retained). */
  getPendingRecords(): readonly ProcessedRecord[] {
    return new GetJobStatus(this.ctx).getPendingRecords();
  }

  /** Get the unique job identifier (UUID). */
  getJobId(): string {
    return new GetJobStatus(this.ctx).getJobId();
  }
}
