import type { ImportSummary, ImportProgress } from '../model/ImportJob.js';
import type { ProcessedRecord } from '../model/Record.js';

/** Emitted when `start()` is called. `totalRecords` is `0` (unknown in streaming mode). */
export interface ImportStartedEvent {
  readonly type: 'import:started';
  readonly jobId: string;
  readonly totalRecords: number;
  readonly totalBatches: number;
  readonly timestamp: number;
}

/** Emitted when all records have been processed successfully. */
export interface ImportCompletedEvent {
  readonly type: 'import:completed';
  readonly jobId: string;
  readonly summary: ImportSummary;
  readonly timestamp: number;
}

/** Emitted when `pause()` is called. */
export interface ImportPausedEvent {
  readonly type: 'import:paused';
  readonly jobId: string;
  readonly progress: ImportProgress;
  readonly timestamp: number;
}

/** Emitted when `abort()` is called. */
export interface ImportAbortedEvent {
  readonly type: 'import:aborted';
  readonly jobId: string;
  readonly progress: ImportProgress;
  readonly timestamp: number;
}

/** Emitted when the import fails due to an unrecoverable error. */
export interface ImportFailedEvent {
  readonly type: 'import:failed';
  readonly jobId: string;
  readonly error: string;
  readonly timestamp: number;
}

/** Emitted after each batch completes with updated progress counters. */
export interface ImportProgressEvent {
  readonly type: 'import:progress';
  readonly jobId: string;
  readonly progress: ImportProgress;
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

/** Discriminated union of all domain events. */
export type DomainEvent =
  | ImportStartedEvent
  | ImportCompletedEvent
  | ImportPausedEvent
  | ImportAbortedEvent
  | ImportFailedEvent
  | ImportProgressEvent
  | BatchStartedEvent
  | BatchCompletedEvent
  | BatchFailedEvent
  | RecordProcessedEvent
  | RecordFailedEvent
  | RecordRetriedEvent;

/** String literal union of all event type names. */
export type EventType = DomainEvent['type'];

/** Extract the payload type for a specific event type. */
export type EventPayload<T extends EventType> = Extract<DomainEvent, { type: T }>;
