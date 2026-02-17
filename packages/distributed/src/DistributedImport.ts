import type {
  SchemaDefinition,
  DataSource,
  SourceParser,
  StateStore,
  RecordProcessorFn,
  ImportHooks,
  DuplicateChecker,
  DomainEvent,
  EventType,
  EventPayload,
} from '@bulkimport/core';
import { EventBus, isDistributedStateStore } from '@bulkimport/core';
import { PrepareDistributedImport } from './PrepareDistributedImport.js';
import type { PrepareResult } from './PrepareDistributedImport.js';
import { ProcessDistributedBatch } from './ProcessDistributedBatch.js';
import type { DistributedBatchResult } from './ProcessDistributedBatch.js';

/** Configuration for distributed import processing. */
export interface DistributedImportConfig {
  /** Schema definition for validation. */
  readonly schema: SchemaDefinition;
  /** Number of records per batch. Default: 100. */
  readonly batchSize?: number;
  /** Whether to continue processing on record errors. Default: true. */
  readonly continueOnError?: boolean;
  /**
   * State store that implements `DistributedStateStore`.
   * Required — must support atomic batch claiming.
   */
  readonly stateStore: StateStore;
  /** Maximum retry attempts for processor failures. Default: 0. */
  readonly maxRetries?: number;
  /** Base delay in ms for retry backoff. Default: 1000. */
  readonly retryDelayMs?: number;
  /** Optional lifecycle hooks. */
  readonly hooks?: ImportHooks;
  /** Optional external duplicate detection. */
  readonly duplicateChecker?: DuplicateChecker;
  /**
   * Timeout in ms for stale batch reclamation. Default: 900000 (15 min).
   * Batches stuck in PROCESSING longer than this are reclaimed for other workers.
   */
  readonly staleBatchTimeoutMs?: number;
}

/**
 * Facade for distributed parallel batch processing.
 *
 * Two-phase processing model:
 * 1. **Prepare** (single orchestrator): streams the source file, materializes
 *    records in the StateStore, and registers batch boundaries.
 * 2. **Process** (N parallel workers): each worker calls `processWorkerBatch()`
 *    in a loop to claim and process batches until none remain.
 *
 * @example
 * ```typescript
 * // === Orchestrator Lambda ===
 * const di = new DistributedImport(config);
 * const { jobId, totalBatches } = await di.prepare(source, parser);
 * // Fan out: send { jobId } to N worker Lambdas via SQS
 *
 * // === Worker Lambda ===
 * const di = new DistributedImport(config);
 * const workerId = context.awsRequestId;
 * while (true) {
 *   const result = await di.processWorkerBatch(jobId, processor, workerId);
 *   if (!result.claimed || result.jobComplete) break;
 * }
 * ```
 */
export class DistributedImport {
  private readonly config: DistributedImportConfig;
  private readonly eventBus: EventBus;

  constructor(config: DistributedImportConfig) {
    if (!isDistributedStateStore(config.stateStore)) {
      throw new Error(
        'DistributedImport requires a DistributedStateStore implementation ' +
          '(e.g. SequelizeStateStore). The InMemoryStateStore does not support ' +
          'distributed batch claiming.',
      );
    }
    this.config = config;
    this.eventBus = new EventBus();
  }

  /**
   * Phase 1: Prepare the job for distributed processing.
   *
   * Streams the entire source, materializes all records in the StateStore,
   * and creates batch metadata. Call this from a single orchestrator.
   *
   * @param source - Data source to read from.
   * @param parser - Parser for the source format.
   * @returns Preparation result with jobId, totalRecords, totalBatches.
   */
  async prepare(source: DataSource, parser: SourceParser): Promise<PrepareResult> {
    const useCase = new PrepareDistributedImport(
      this.config.schema,
      this.config.stateStore,
      this.eventBus,
      this.config.batchSize ?? 100,
    );
    return useCase.execute(source, parser);
  }

  /**
   * Phase 2: Claim and process the next available batch.
   *
   * Atomically claims an unclaimed batch, loads its records from the
   * StateStore, validates and processes them. Returns immediately if
   * no batches are available.
   *
   * Before claiming, reclaims any stale batches that have been stuck
   * in PROCESSING longer than `staleBatchTimeoutMs`.
   *
   * Call this from each worker in a loop until `claimed` is `false`
   * or `jobComplete` is `true`.
   *
   * @param jobId - The job ID returned by `prepare()`.
   * @param processor - Callback invoked for each valid record. Must be idempotent.
   * @param workerId - Unique identifier for this worker (e.g. Lambda request ID).
   * @returns Result with batch details, counts, and completion status.
   */
  async processWorkerBatch(
    jobId: string,
    processor: RecordProcessorFn,
    workerId: string,
  ): Promise<DistributedBatchResult> {
    // Reclaim stale batches before claiming
    const timeoutMs = this.config.staleBatchTimeoutMs ?? 900_000;
    const store = this.config.stateStore;
    if (isDistributedStateStore(store)) {
      await store.reclaimStaleBatches(jobId, timeoutMs);
    }

    const useCase = new ProcessDistributedBatch(
      {
        schema: this.config.schema,
        stateStore: this.config.stateStore,
        continueOnError: this.config.continueOnError,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
        hooks: this.config.hooks,
        duplicateChecker: this.config.duplicateChecker,
      },
      this.eventBus,
    );
    return useCase.execute(jobId, processor, workerId);
  }

  /**
   * Subscribe to a specific domain event type.
   *
   * Events are local to this `DistributedImport` instance. Each worker
   * has its own event bus. The `import:completed` event is only emitted
   * by the worker that finalizes the job (exactly-once).
   */
  on<T extends EventType>(type: T, handler: (event: EventPayload<T>) => void): this {
    this.eventBus.on(type, handler);
    return this;
  }

  /** Subscribe to all domain events. */
  onAny(handler: (event: DomainEvent) => void): this {
    this.eventBus.onAny(handler);
    return this;
  }

  /** Unsubscribe a wildcard handler. */
  offAny(handler: (event: DomainEvent) => void): this {
    this.eventBus.offAny(handler);
    return this;
  }
}
