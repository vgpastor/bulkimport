// Main entry point
export { BulkImport } from './BulkImport.js';
export type { BulkImportConfig, GenerateTemplateOptions } from './BulkImport.js';

// Domain model
export type { SchemaDefinition } from './domain/model/Schema.js';
export type { FieldDefinition, FieldType, ValidationFieldResult } from './domain/model/FieldDefinition.js';
export type { PreviewResult } from './domain/model/PreviewResult.js';

// Domain services
export { SchemaValidator } from './domain/services/SchemaValidator.js';

// Domain ports
export type { SourceParser, ParserOptions } from './domain/ports/SourceParser.js';
export type { DuplicateChecker, DuplicateCheckResult } from './domain/ports/DuplicateChecker.js';

// Infrastructure adapters (built-in parsers)
export { CsvParser } from './infrastructure/parsers/CsvParser.js';
export { JsonParser } from './infrastructure/parsers/JsonParser.js';
export type { JsonParserOptions } from './infrastructure/parsers/JsonParser.js';
export { XmlParser } from './infrastructure/parsers/XmlParser.js';
export type { XmlParserOptions } from './infrastructure/parsers/XmlParser.js';

// Re-export commonly used types from @batchactions/core for convenience
export type {
  RawRecord,
  ParsedRecord,
  ProcessedRecord,
  RecordStatus,
  JobState,
  JobConfig,
  JobProgress,
  JobSummary,
  Batch,
  ValidationResult,
  ValidationError,
  ValidationErrorCode,
  ErrorSeverity,
  ErrorCategory,
  DataSource,
  StateStore,
  RecordProcessorFn,
  ProcessingContext,
  JobHooks,
  HookContext,
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
  ChunkOptions,
  ChunkResult,
  JobStatusResult,
} from '@batchactions/core';

export {
  JobStatus,
  BatchStatus,
  hasErrors,
  getWarnings,
  getErrors,
  validResult,
  invalidResult,
  isEmptyRow,
  BufferSource,
  FilePathSource,
  StreamSource,
  UrlSource,
  InMemoryStateStore,
  FileStateStore,
  BatchEngine,
  BatchSplitter,
} from '@batchactions/core';
