/** Describes a batch that has been claimed by a worker for processing. */
export interface BatchReservation {
  /** The job this batch belongs to. */
  readonly jobId: string;
  /** Unique batch identifier. */
  readonly batchId: string;
  /** Zero-based batch index within the job. */
  readonly batchIndex: number;
  /** Unique identifier of the worker that claimed this batch. */
  readonly workerId: string;
  /** Epoch timestamp when the batch was claimed. */
  readonly claimedAt: number;
  /** First record index in this batch (inclusive). */
  readonly recordStartIndex: number;
  /** Last record index in this batch (inclusive). */
  readonly recordEndIndex: number;
}

/** Result of attempting to claim a batch for distributed processing. */
export type ClaimBatchResult =
  | { readonly claimed: true; readonly reservation: BatchReservation }
  | { readonly claimed: false; readonly reason: ClaimBatchFailureReason };

/** Reason why a batch claim attempt failed. */
export type ClaimBatchFailureReason = 'NO_PENDING_BATCHES' | 'JOB_NOT_FOUND' | 'JOB_NOT_PROCESSING';

/** Aggregated status of all batches in a distributed job. */
export interface DistributedJobStatus {
  /** The job identifier. */
  readonly jobId: string;
  /** Total number of batches in the job. */
  readonly totalBatches: number;
  /** Batches that have been successfully processed. */
  readonly completedBatches: number;
  /** Batches that failed processing. */
  readonly failedBatches: number;
  /** Batches currently being processed by a worker. */
  readonly processingBatches: number;
  /** Batches waiting to be claimed. */
  readonly pendingBatches: number;
  /** `true` when all batches are in a terminal state (COMPLETED or FAILED). */
  readonly isComplete: boolean;
}
