import type { JobStatus } from './JobStatus.js';
import type { Batch } from './Batch.js';

/** Configuration snapshot stored as part of the job state. */
export interface JobConfig {
  readonly id?: string;
  readonly schema?: Record<string, unknown>;
  readonly batchSize: number;
  readonly maxConcurrentBatches?: number;
  readonly continueOnError?: boolean;
}

/** Serialisable state of a job (for persistence via StateStore). */
export interface JobState {
  readonly id: string;
  readonly config: JobConfig;
  readonly status: JobStatus;
  readonly batches: readonly Batch[];
  readonly totalRecords: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  /** When `true`, this job uses distributed batch processing. */
  readonly distributed?: boolean;
}

/** Real-time progress counters for an in-flight job. */
export interface JobProgress {
  readonly totalRecords: number;
  readonly processedRecords: number;
  readonly failedRecords: number;
  readonly pendingRecords: number;
  /** Completion percentage (0–100). Includes both processed and failed records. */
  readonly percentage: number;
  readonly currentBatch: number;
  readonly totalBatches: number;
  readonly elapsedMs: number;
  readonly estimatedRemainingMs?: number;
}

/** Final summary emitted with the `job:completed` event. */
export interface JobSummary {
  readonly total: number;
  readonly processed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly elapsedMs: number;
}
