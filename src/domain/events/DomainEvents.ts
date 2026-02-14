import type { ImportSummary, ImportProgress } from '../model/ImportJob.js';
import type { ProcessedRecord } from '../model/Record.js';

export interface ImportStartedEvent {
  readonly type: 'import:started';
  readonly jobId: string;
  readonly totalRecords: number;
  readonly totalBatches: number;
  readonly timestamp: number;
}

export interface ImportCompletedEvent {
  readonly type: 'import:completed';
  readonly jobId: string;
  readonly summary: ImportSummary;
  readonly timestamp: number;
}

export interface ImportPausedEvent {
  readonly type: 'import:paused';
  readonly jobId: string;
  readonly progress: ImportProgress;
  readonly timestamp: number;
}

export interface ImportAbortedEvent {
  readonly type: 'import:aborted';
  readonly jobId: string;
  readonly progress: ImportProgress;
  readonly timestamp: number;
}

export interface ImportFailedEvent {
  readonly type: 'import:failed';
  readonly jobId: string;
  readonly error: string;
  readonly timestamp: number;
}

export interface ImportProgressEvent {
  readonly type: 'import:progress';
  readonly jobId: string;
  readonly progress: ImportProgress;
  readonly timestamp: number;
}

export interface BatchStartedEvent {
  readonly type: 'batch:started';
  readonly jobId: string;
  readonly batchId: string;
  readonly batchIndex: number;
  readonly recordCount: number;
  readonly timestamp: number;
}

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

export interface BatchFailedEvent {
  readonly type: 'batch:failed';
  readonly jobId: string;
  readonly batchId: string;
  readonly batchIndex: number;
  readonly error: string;
  readonly timestamp: number;
}

export interface RecordProcessedEvent {
  readonly type: 'record:processed';
  readonly jobId: string;
  readonly batchId: string;
  readonly recordIndex: number;
  readonly timestamp: number;
}

export interface RecordFailedEvent {
  readonly type: 'record:failed';
  readonly jobId: string;
  readonly batchId: string;
  readonly recordIndex: number;
  readonly error: string;
  readonly record: ProcessedRecord;
  readonly timestamp: number;
}

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
  | RecordFailedEvent;

export type EventType = DomainEvent['type'];

export type EventPayload<T extends EventType> = Extract<DomainEvent, { type: T }>;
