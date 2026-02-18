// Main entry point
export { BatchEngine } from './BatchEngine.js';
export type { BatchEngineConfig, ValidateFn } from './BatchEngine.js';

// Domain model
export type { JobState, JobConfig, JobProgress, JobSummary } from './domain/model/Job.js';
export type { ProcessedRecord, RawRecord, ParsedRecord, RecordStatus } from './domain/model/Record.js';
export { isEmptyRow } from './domain/model/Record.js';
export type { Batch } from './domain/model/Batch.js';
export type {
  ValidationResult,
  ValidationError,
  ValidationErrorCode,
  ErrorSeverity,
  ErrorCategory,
} from './domain/model/ValidationResult.js';
export { hasErrors, getWarnings, getErrors, validResult, invalidResult } from './domain/model/ValidationResult.js';
export { JobStatus } from './domain/model/JobStatus.js';
export { BatchStatus } from './domain/model/BatchStatus.js';

// Use case result types
export type { JobStatusResult } from './application/usecases/GetJobStatus.js';
export type { ChunkOptions, ChunkResult } from './application/usecases/ProcessChunk.js';

// Domain services
export { BatchSplitter } from './domain/services/BatchSplitter.js';

// Domain model functions (for building custom processing pipelines)
export { createPendingRecord, markRecordValid, markRecordInvalid, markRecordFailed } from './domain/model/Record.js';
export { createBatch, clearBatchRecords } from './domain/model/Batch.js';

// Application internals (for @batchactions/distributed and other extension packages)
export { EventBus } from './application/EventBus.js';
export { JobContext } from './application/JobContext.js';

// Ports (for custom implementations)
export type { DataSource, SourceMetadata } from './domain/ports/DataSource.js';
export type { StateStore, BatchState } from './domain/ports/StateStore.js';
export type { RecordProcessorFn, ProcessingContext } from './domain/ports/RecordProcessor.js';
export type { JobHooks, HookContext } from './domain/ports/JobHooks.js';

// Distributed processing types
export type { DistributedStateStore } from './domain/ports/DistributedStateStore.js';
export { isDistributedStateStore } from './domain/ports/DistributedStateStore.js';
export type {
  BatchReservation,
  ClaimBatchResult,
  ClaimBatchFailureReason,
  DistributedJobStatus,
} from './domain/model/BatchReservation.js';

// Domain events
export type {
  DomainEvent,
  EventType,
  EventPayload,
  JobStartedEvent,
  JobCompletedEvent,
  JobPausedEvent,
  JobAbortedEvent,
  JobFailedEvent,
  JobProgressEvent,
  BatchStartedEvent,
  BatchCompletedEvent,
  BatchFailedEvent,
  RecordProcessedEvent,
  RecordFailedEvent,
  RecordRetriedEvent,
  ChunkCompletedEvent,
  BatchClaimedEvent,
  DistributedPreparedEvent,
} from './domain/events/DomainEvents.js';

// Infrastructure adapters (built-in sources and state stores)
export { BufferSource } from './infrastructure/sources/BufferSource.js';
export { FilePathSource } from './infrastructure/sources/FilePathSource.js';
export type { FilePathSourceOptions } from './infrastructure/sources/FilePathSource.js';
export { StreamSource } from './infrastructure/sources/StreamSource.js';
export type { StreamSourceOptions } from './infrastructure/sources/StreamSource.js';
export { UrlSource } from './infrastructure/sources/UrlSource.js';
export type { UrlSourceOptions } from './infrastructure/sources/UrlSource.js';
export { InMemoryStateStore } from './infrastructure/state/InMemoryStateStore.js';
export { FileStateStore } from './infrastructure/state/FileStateStore.js';
export type { FileStateStoreOptions } from './infrastructure/state/FileStateStore.js';
