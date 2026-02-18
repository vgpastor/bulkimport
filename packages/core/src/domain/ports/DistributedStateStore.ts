import type { StateStore } from './StateStore.js';
import type { ProcessedRecord } from '../model/Record.js';
import type { ClaimBatchResult, DistributedJobStatus } from '../model/BatchReservation.js';

/**
 * Extended StateStore port for distributed multi-worker batch processing.
 *
 * Adds atomic batch claiming, pre-materialized record storage,
 * and completion detection. Implementations must guarantee atomicity
 * of `claimBatch()` to prevent duplicate processing.
 *
 * The base `StateStore` methods remain unchanged — this interface only
 * adds new capabilities required for distributed mode.
 */
export interface DistributedStateStore extends StateStore {
  /**
   * Atomically claim the next available PENDING batch for a worker.
   *
   * Implementation must use an atomic compare-and-swap or row-level locking
   * to ensure no two workers claim the same batch. Transitions the batch
   * from PENDING to PROCESSING and records the workerId and timestamp.
   *
   * @param jobId - The job to claim a batch from.
   * @param workerId - Unique identifier for the claiming worker (e.g. Lambda request ID).
   * @returns Claim result with reservation details, or reason for failure.
   */
  claimBatch(jobId: string, workerId: string): Promise<ClaimBatchResult>;

  /**
   * Release a previously claimed batch back to PENDING status.
   *
   * Used when a worker fails or wants to gracefully release work.
   * Only releases if the batch is still assigned to the specified workerId
   * (prevents releasing a batch that was already reclaimed by timeout recovery).
   *
   * @param jobId - The job containing the batch.
   * @param batchId - The batch to release.
   * @param workerId - The worker releasing the batch. Must match the current claim.
   */
  releaseBatch(jobId: string, batchId: string, workerId: string): Promise<void>;

  /**
   * Reclaim batches that have been in PROCESSING state longer than the timeout.
   *
   * Transitions stale PROCESSING batches back to PENDING so they can be
   * claimed by other workers. Returns the number of batches reclaimed.
   *
   * This is safe to call concurrently and is idempotent.
   *
   * @param jobId - The job to check.
   * @param timeoutMs - Maximum time a batch can remain in PROCESSING before being reclaimed.
   * @returns Number of batches reclaimed.
   */
  reclaimStaleBatches(jobId: string, timeoutMs: number): Promise<number>;

  /**
   * Save a batch of pre-materialized records (used during the prepare phase).
   *
   * More efficient than calling `saveProcessedRecord()` one at a time.
   * The implementation should use bulk insert when possible.
   *
   * @param jobId - The job the records belong to.
   * @param batchId - The batch the records belong to.
   * @param records - The records to save.
   */
  saveBatchRecords(jobId: string, batchId: string, records: readonly ProcessedRecord[]): Promise<void>;

  /**
   * Retrieve all records belonging to a specific batch.
   *
   * Used by workers after claiming a batch to load the records
   * they need to validate and process.
   *
   * @param jobId - The job containing the batch.
   * @param batchId - The batch whose records to retrieve.
   * @returns Records in the batch, ordered by recordIndex.
   */
  getBatchRecords(jobId: string, batchId: string): Promise<readonly ProcessedRecord[]>;

  /**
   * Get the distributed processing status for a job.
   *
   * Aggregates batch statuses to determine overall completion.
   * Used by workers after processing their batch to check if the
   * job is complete and should be finalized.
   *
   * @param jobId - The job to check.
   */
  getDistributedStatus(jobId: string): Promise<DistributedJobStatus>;

  /**
   * Atomically check and finalize a job if all batches are complete.
   *
   * Returns `true` if this call transitioned the job to its terminal state
   * (COMPLETED or FAILED). Only one worker will get `true` — the rest get
   * `false`. This prevents multiple workers from emitting duplicate
   * completion events.
   *
   * @param jobId - The job to potentially finalize.
   * @returns Whether this call finalized the job.
   */
  tryFinalizeJob(jobId: string): Promise<boolean>;
}

/** Check whether a StateStore supports distributed batch processing. */
export function isDistributedStateStore(store: StateStore): store is DistributedStateStore {
  return (
    'claimBatch' in store &&
    'releaseBatch' in store &&
    'getBatchRecords' in store &&
    'getDistributedStatus' in store &&
    'tryFinalizeJob' in store
  );
}
