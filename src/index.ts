// Main entry point
export { BulkImport } from './BulkImport.js';
export type { BulkImportConfig } from './BulkImport.js';

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
export type { ProcessedRecord, RawRecord, RecordStatus } from './domain/model/Record.js';
export { isEmptyRow } from './domain/model/Record.js';
export type { Batch } from './domain/model/Batch.js';
export type { ValidationResult, ValidationError, ValidationErrorCode } from './domain/model/ValidationResult.js';
export { ImportStatus } from './domain/model/ImportStatus.js';
export { BatchStatus } from './domain/model/BatchStatus.js';

// Domain services
export { BatchSplitter } from './domain/services/BatchSplitter.js';

// Ports (for custom implementations)
export type { SourceParser, ParserOptions } from './domain/ports/SourceParser.js';
export type { DataSource, SourceMetadata } from './domain/ports/DataSource.js';
export type { StateStore, BatchState } from './domain/ports/StateStore.js';
export type { RecordProcessorFn, ProcessingContext } from './domain/ports/RecordProcessor.js';

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
