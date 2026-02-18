import type { JobSummary, JobProgress } from '../model/Job.js';
import type { ProcessedRecord } from '../model/Record.js';

/** Emitted when `start()` is called. `totalRecords` is `0` (unknown in streaming mode). */
export interface JobStartedEvent {
  readonly type: 'job:started';
  readonly jobId: string;
  readonly totalRecords: number;
  readonly totalBatches: number;
  readonly timestamp: number;
}

/** Emitted when all records have been processed successfully. */
export interface JobCompletedEvent {
  readonly type: 'job:completed';
  readonly jobId: string;
  readonly summary: JobSummary;
  readonly timestamp: number;
}

/** Emitted when `pause()` is called. */
export interface JobPausedEvent {
  readonly type: 'job:paused';
  readonly jobId: string;
  readonly progress: JobProgress;
  readonly timestamp: number;
}

/** Emitted when `abort()` is called. */
export interface JobAbortedEvent {
  readonly type: 'job:aborted';
  readonly jobId: string;
  readonly progress: JobProgress;
  readonly timestamp: number;
}

/** Emitted when the job fails due to an unrecoverable error. */
export interface JobFailedEvent {
  readonly type: 'job:failed';
  readonly jobId: string;
  readonly error: string;
  readonly timestamp: number;
}

/** Emitted after each batch completes with updated progress counters. */
export interface JobProgressEvent {
  readonly type: 'job:progress';
  readonly jobId: string;
  readonly progress: JobProgress;
  readonly timestamp: number;
}

/** Emitted when a batch begins processing. */
export interface BatchStartedEvent {
  readonly type: 'batch:started';
  readonly jobId: string;
  readonly batchId: string;
  readonly batchIndex: number;
  readonly recordCount: number;
  readonly timestamp: number;
}

/** Emitted when a batch finishes processing (may include failed records). */
export interface BatchCompletedEvent {
  readonly type: 'batch:completed';
  readonly jobId: string;
  readonly batchId: string;
  readonly batchIndex: number;
  readonly processedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;
  readonly timestamp: number;
}

/** Emitted when a batch fails entirely (e.g. `continueOnError: false`). */
export interface BatchFailedEvent {
  readonly type: 'batch:failed';
  readonly jobId: string;
  readonly batchId: string;
  readonly batchIndex: number;
  readonly error: string;
  readonly timestamp: number;
}

/** Emitted for each record that is successfully processed. */
export interface RecordProcessedEvent {
  readonly type: 'record:processed';
  readonly jobId: string;
  readonly batchId: string;
  readonly recordIndex: number;
  readonly timestamp: number;
}

/** Emitted for each record that fails validation or processing. */
export interface RecordFailedEvent {
  readonly type: 'record:failed';
  readonly jobId: string;
  readonly batchId: string;
  readonly recordIndex: number;
  readonly error: string;
  readonly record: ProcessedRecord;
  readonly timestamp: number;
}

/** Emitted when a failed record is about to be retried. */
export interface RecordRetriedEvent {
  readonly type: 'record:retried';
  readonly jobId: string;
  readonly batchId: string;
  readonly recordIndex: number;
  /** Current attempt number (1-based). */
  readonly attempt: number;
  /** Maximum retries configured. */
  readonly maxRetries: number;
  /** Error from the previous attempt. */
  readonly error: string;
  readonly timestamp: number;
}

/** Emitted when a chunk finishes processing (either limit reached or all records done). */
export interface ChunkCompletedEvent {
  readonly type: 'chunk:completed';
  readonly jobId: string;
  /** Records successfully processed in this chunk. */
  readonly processedRecords: number;
  /** Records that failed in this chunk. */
  readonly failedRecords: number;
  /** `true` when all records have been processed (job complete). */
  readonly done: boolean;
  readonly timestamp: number;
}

/** Emitted when a worker claims a batch in distributed mode. */
export interface BatchClaimedEvent {
  readonly type: 'batch:claimed';
  readonly jobId: string;
  readonly batchId: string;
  readonly batchIndex: number;
  readonly workerId: string;
  readonly timestamp: number;
}

/** Emitted when the prepare phase of distributed processing completes. */
export interface DistributedPreparedEvent {
  readonly type: 'distributed:prepared';
  readonly jobId: string;
  readonly totalRecords: number;
  readonly totalBatches: number;
  readonly timestamp: number;
}

/** Discriminated union of all domain events. */
export type DomainEvent =
  | JobStartedEvent
  | JobCompletedEvent
  | JobPausedEvent
  | JobAbortedEvent
  | JobFailedEvent
  | JobProgressEvent
  | BatchStartedEvent
  | BatchCompletedEvent
  | BatchFailedEvent
  | RecordProcessedEvent
  | RecordFailedEvent
  | RecordRetriedEvent
  | ChunkCompletedEvent
  | BatchClaimedEvent
  | DistributedPreparedEvent;

/** String literal union of all event type names. */
export type EventType = DomainEvent['type'];

/** Extract the payload type for a specific event type. */
export type EventPayload<T extends EventType> = Extract<DomainEvent, { type: T }>;
