// Main entry point
export { BulkImport } from './BulkImport.js';
export type { BulkImportConfig, GenerateTemplateOptions } from './BulkImport.js';

// Domain model
export type { SchemaDefinition } from './domain/model/Schema.js';
export type { FieldDefinition, FieldType, ValidationFieldResult } from './domain/model/FieldDefinition.js';
export type {
  ImportJobState,
  ImportJobConfig,
  ImportProgress,
  ImportSummary,
  PreviewResult,
} from './domain/model/ImportJob.js';
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
export { hasErrors, getWarnings, getErrors } from './domain/model/ValidationResult.js';
export { ImportStatus } from './domain/model/ImportStatus.js';
export { BatchStatus } from './domain/model/BatchStatus.js';

// Use case result types
export type { ImportStatusResult } from './application/usecases/GetImportStatus.js';
export type { ChunkOptions, ChunkResult } from './application/usecases/ProcessChunk.js';

// Domain services
export { BatchSplitter } from './domain/services/BatchSplitter.js';
export { SchemaValidator } from './domain/services/SchemaValidator.js';

// Domain model functions (for building custom processing pipelines)
export { createPendingRecord, markRecordValid, markRecordInvalid, markRecordFailed } from './domain/model/Record.js';
export { createBatch, clearBatchRecords } from './domain/model/Batch.js';

// Application internals (for @bulkimport/distributed and other extension packages)
export { EventBus } from './application/EventBus.js';
export { ImportJobContext } from './application/ImportJobContext.js';

// Ports (for custom implementations)
export type { SourceParser, ParserOptions } from './domain/ports/SourceParser.js';
export type { DataSource, SourceMetadata } from './domain/ports/DataSource.js';
export type { StateStore, BatchState } from './domain/ports/StateStore.js';
export type { RecordProcessorFn, ProcessingContext } from './domain/ports/RecordProcessor.js';
export type { ImportHooks, HookContext } from './domain/ports/ImportHooks.js';
export type { DuplicateChecker, DuplicateCheckResult } from './domain/ports/DuplicateChecker.js';
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
  ImportStartedEvent,
  ImportCompletedEvent,
  ImportPausedEvent,
  ImportAbortedEvent,
  ImportFailedEvent,
  ImportProgressEvent,
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

// Infrastructure adapters (built-in)
export { CsvParser } from './infrastructure/parsers/CsvParser.js';
export { JsonParser } from './infrastructure/parsers/JsonParser.js';
export type { JsonParserOptions } from './infrastructure/parsers/JsonParser.js';
export { XmlParser } from './infrastructure/parsers/XmlParser.js';
export type { XmlParserOptions } from './infrastructure/parsers/XmlParser.js';
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
