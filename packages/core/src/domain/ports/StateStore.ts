import type { JobState, JobProgress } from '../model/Job.js';
import type { BatchStatus } from '../model/BatchStatus.js';
import type { ProcessedRecord } from '../model/Record.js';

/** Snapshot of a batch's state for persistence. */
export interface BatchState {
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly processedCount: number;
  readonly failedCount: number;
}

/**
 * Port for persisting job state.
 *
 * Implement this interface to store state in a database, file system, or any
 * other storage backend. The default `InMemoryStateStore` is non-persistent.
 *
 * Note: `BatchEngine` currently only calls `saveJobState()` and `getJobState()`.
 * The remaining methods are defined for future `restore()` support.
 */
export interface StateStore {
  /** Persist the full job state. */
  saveJobState(job: JobState): Promise<void>;
  /** Retrieve a previously saved job state by ID. */
  getJobState(jobId: string): Promise<JobState | null>;
  /** Update the state of a specific batch within a job. */
  updateBatchState(jobId: string, batchId: string, state: BatchState): Promise<void>;
  /** Persist a processed record (for recovery after crash). */
  saveProcessedRecord(jobId: string, batchId: string, record: ProcessedRecord): Promise<void>;
  /** Retrieve all records that failed validation or processing. */
  getFailedRecords(jobId: string): Promise<readonly ProcessedRecord[]>;
  /** Retrieve all records not yet processed. */
  getPendingRecords(jobId: string): Promise<readonly ProcessedRecord[]>;
  /** Retrieve all successfully processed records. */
  getProcessedRecords(jobId: string): Promise<readonly ProcessedRecord[]>;
  /** Calculate progress from persisted state. */
  getProgress(jobId: string): Promise<JobProgress>;
}
