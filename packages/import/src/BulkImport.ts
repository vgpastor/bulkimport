import type { SchemaDefinition } from './domain/model/Schema.js';
import type { FieldDefinition } from './domain/model/FieldDefinition.js';
import type { PreviewResult } from './domain/model/PreviewResult.js';
import type { SourceParser } from './domain/ports/SourceParser.js';
import type { DuplicateChecker } from './domain/ports/DuplicateChecker.js';
import {
  BatchEngine,
  type BatchEngineConfig,
  type RawRecord,
  type ProcessedRecord,
  type DataSource,
  type JobStatus,
  type JobProgress,
  type Batch,
  type DomainEvent,
  type EventType,
  type EventPayload,
  type RecordProcessorFn,
  type JobHooks,
  type HookContext,
  type StateStore,
  type ValidationError,
  type ValidationResult,
  hasErrors,
  invalidResult,
  markRecordInvalid,
  validResult,
} from '@batchactions/core';
import type { ChunkOptions, ChunkResult } from '@batchactions/core';
import { SchemaValidator } from './domain/services/SchemaValidator.js';
import { PreviewImport } from './application/usecases/PreviewImport.js';

/** Options for `BulkImport.generateTemplate()`. */
export interface GenerateTemplateOptions {
  /** Number of example rows to include with synthetic data. Default: `0` (header only). */
  readonly exampleRows?: number;
}

/** Configuration for a bulk import job. */
export interface BulkImportConfig {
  /** Schema defining field types, validation rules, aliases, and uniqueness constraints. */
  readonly schema: SchemaDefinition;
  /** Number of records per batch. Default: `100`. */
  readonly batchSize?: number;
  /** Maximum number of batches to process concurrently. Default: `1` (sequential). */
  readonly maxConcurrentBatches?: number;
  /** When `true`, processing continues after a record fails validation or processing. Default: `false`. */
  readonly continueOnError?: boolean;
  /** Persistence adapter for job state. Default: `InMemoryStateStore`. */
  readonly stateStore?: StateStore;
  /**
   * Maximum number of retry attempts for records that fail during processing.
   * Only processor errors are retried — validation failures are never retried.
   * Default: `0` (no retries).
   */
  readonly maxRetries?: number;
  /**
   * Base delay in milliseconds between retry attempts.
   * Uses exponential backoff: `retryDelayMs * 2^(attempt - 1)`.
   * Default: `1000`.
   */
  readonly retryDelayMs?: number;
  /** Lifecycle hooks for intercepting the record processing pipeline. */
  readonly hooks?: JobHooks;
  /**
   * Adapter for checking records against external data sources for duplicates.
   *
   * The built-in `uniqueFields` schema option handles in-memory cross-record
   * uniqueness within the import; this option is for checking against data that
   * already exists outside the current import (e.g. a database).
   */
  readonly duplicateChecker?: DuplicateChecker;
}

/**
 * Facade that orchestrates the full import lifecycle: parse → validate → batch → process.
 *
 * Wraps `BatchEngine` from `@batchactions/core` and adds schema-based validation,
 * alias resolution, transforms, uniqueness checks, duplicate detection, preview,
 * and template generation.
 *
 * @example
 * ```typescript
 * const importer = new BulkImport({ schema: { fields: [...] }, batchSize: 500 });
 * importer.from(new BufferSource(csv), new CsvParser());
 * await importer.start(async (record) => { await db.insert(record); });
 * ```
 */
export class BulkImport {
  private readonly engine: BatchEngine;
  private readonly validator: SchemaValidator;
  private readonly duplicateChecker: DuplicateChecker | null;
  private readonly seenUniqueValues = new Map<string, Set<unknown>>();
  private source: DataSource | null = null;
  private parser: SourceParser | null = null;

  constructor(config: BulkImportConfig) {
    this.validator = new SchemaValidator(config.schema);
    this.duplicateChecker = config.duplicateChecker ?? null;

    const engineConfig: BatchEngineConfig = {
      batchSize: config.batchSize,
      maxConcurrentBatches: config.maxConcurrentBatches,
      continueOnError: config.continueOnError,
      stateStore: config.stateStore,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
      hooks: this.buildHooks(config.hooks),
      skipEmptyRows: config.schema.skipEmptyRows,
      validate: (record: RawRecord) => this.fullValidation(record),
    };

    this.engine = new BatchEngine(engineConfig);
  }

  /**
   * Build the hooks passed to the engine, wrapping user hooks with
   * import-specific logic (e.g. DuplicateChecker in afterValidate).
   */
  private buildHooks(userHooks?: JobHooks): JobHooks | undefined {
    if (!this.duplicateChecker && !userHooks) return undefined;

    const checker = this.duplicateChecker;
    const userAfterValidate = userHooks?.afterValidate;

    return {
      ...userHooks,
      afterValidate:
        checker || userAfterValidate
          ? async (record: ProcessedRecord, hookCtx: HookContext): Promise<ProcessedRecord> => {
              let current = record;

              // Run external duplicate check for valid records
              if (checker && current.status !== 'invalid') {
                const processingCtx = {
                  jobId: hookCtx.jobId,
                  batchId: hookCtx.batchId,
                  batchIndex: hookCtx.batchIndex,
                  recordIndex: hookCtx.recordIndex,
                  totalRecords: hookCtx.totalRecords,
                  signal: hookCtx.signal,
                };

                try {
                  const dupResult = await checker.check(current.parsed, processingCtx);
                  if (dupResult.isDuplicate) {
                    const dupError: ValidationError = {
                      field: '_external',
                      message: `Duplicate record found${dupResult.existingId ? ` (existing ID: ${dupResult.existingId})` : ''}`,
                      code: 'EXTERNAL_DUPLICATE',
                      value: undefined,
                    };
                    current = markRecordInvalid(current, [...current.errors, dupError]);
                  }
                } catch (checkerError) {
                  const errorMsg = checkerError instanceof Error ? checkerError.message : String(checkerError);
                  const failError: ValidationError = {
                    field: '_external',
                    message: `Duplicate check failed: ${errorMsg}`,
                    code: 'EXTERNAL_DUPLICATE',
                    value: undefined,
                  };
                  current = markRecordInvalid(current, [...current.errors, failError]);
                }
              }

              // Chain user's afterValidate hook
              if (userAfterValidate) {
                current = await userAfterValidate(current, hookCtx);
              }

              return current;
            }
          : userHooks?.afterValidate,
    };
  }

  /**
   * Restore an import job from persisted state.
   *
   * @param jobId - The job ID to restore.
   * @param config - Configuration with stateStore that holds the persisted state.
   * @returns A `BulkImport` instance ready to resume, or `null` if the job was not found.
   */
  static async restore(jobId: string, config: BulkImportConfig): Promise<BulkImport | null> {
    const stateStore = config.stateStore;
    if (!stateStore) return null;

    const jobState = await stateStore.getJobState(jobId);
    if (!jobState) return null;

    const instance = new BulkImport(config);

    // Delegate to BatchEngine.restore internally
    const restoredEngine = await BatchEngine.restore(jobId, {
      batchSize: config.batchSize,
      maxConcurrentBatches: config.maxConcurrentBatches,
      continueOnError: config.continueOnError,
      stateStore: config.stateStore,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
      hooks: instance.buildHooks(config.hooks),
      skipEmptyRows: config.schema.skipEmptyRows,
      validate: (record: RawRecord) => instance.fullValidation(record),
    });

    if (!restoredEngine) return null;

    // Replace the engine on the instance with the restored one
    (instance as unknown as { engine: BatchEngine }).engine = restoredEngine;

    return instance;
  }

  /**
   * Generate a CSV template from a schema definition.
   *
   * Returns a CSV string with the header row and optionally synthetic example
   * rows. The example data is generated based on each field's type.
   *
   * @param schema - The schema defining the fields.
   * @param options - Optional settings (e.g. `exampleRows` count).
   */
  static generateTemplate(schema: SchemaDefinition, options?: GenerateTemplateOptions): string {
    const header = schema.fields.map((f) => f.name).join(',');
    const rowCount = options?.exampleRows ?? 0;

    if (rowCount <= 0) return header;

    const rows: string[] = [header];
    for (let i = 1; i <= rowCount; i++) {
      rows.push(schema.fields.map((f) => BulkImport.generateExampleValue(f, i)).join(','));
    }

    return rows.join('\n');
  }

  private static generateExampleValue(field: FieldDefinition, rowIndex: number): string {
    if (field.defaultValue !== undefined) {
      return typeof field.defaultValue === 'string' ? field.defaultValue : JSON.stringify(field.defaultValue);
    }

    switch (field.type) {
      case 'email':
        return `user${String(rowIndex)}@example.com`;
      case 'number':
        return String(rowIndex * 100);
      case 'boolean':
        return rowIndex % 2 === 0 ? 'true' : 'false';
      case 'date':
        return `2024-01-${String(rowIndex).padStart(2, '0')}`;
      case 'array':
        return `value${String(rowIndex)}a${field.separator ?? ','}value${String(rowIndex)}b`;
      case 'string':
      case 'custom':
      default:
        return `${field.name}_${String(rowIndex)}`;
    }
  }

  /** Set the data source and parser. Returns `this` for chaining. */
  from(source: DataSource, parser: SourceParser): this {
    this.source = source;
    this.parser = parser;
    this.engine.from(source, parser);
    return this;
  }

  /** Subscribe to a lifecycle event. Returns `this` for chaining. */
  on<T extends EventType>(type: T, handler: (event: EventPayload<T>) => void): this {
    this.engine.on(type, handler);
    return this;
  }

  /** Subscribe to all events regardless of type. Returns `this` for chaining. */
  onAny(handler: (event: DomainEvent) => void): this {
    this.engine.onAny(handler);
    return this;
  }

  /** Unsubscribe a wildcard handler previously registered with `onAny()`. */
  offAny(handler: (event: DomainEvent) => void): this {
    this.engine.offAny(handler);
    return this;
  }

  /**
   * Validate a sample of records without processing them.
   *
   * Alias resolution and transforms are applied before validation.
   * Returns valid/invalid records, total sampled, and detected column names.
   */
  async preview(maxRecords = 10): Promise<PreviewResult> {
    if (!this.source || !this.parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }
    return new PreviewImport(this.source, this.parser, this.validator).execute(maxRecords);
  }

  /**
   * Count total records in the configured source without processing them.
   *
   * @returns Total number of records in the source.
   */
  async count(): Promise<number> {
    return this.engine.count();
  }

  /**
   * Begin processing all records through the provided callback.
   *
   * Records are parsed lazily (streamed) and processed batch-by-batch.
   *
   * @throws Error if source/parser not configured or import already started.
   */
  async start(processor: RecordProcessorFn): Promise<void> {
    return this.engine.start(processor);
  }

  /**
   * Process a limited chunk of records, then pause and return control.
   *
   * Designed for serverless environments with execution time limits.
   */
  async processChunk(processor: RecordProcessorFn, options?: ChunkOptions): Promise<ChunkResult> {
    return this.engine.processChunk(processor, options);
  }

  /** Pause processing after the current record completes. */
  async pause(): Promise<void> {
    return this.engine.pause();
  }

  /** Resume a paused import. */
  resume(): void {
    this.engine.resume();
  }

  /** Cancel the import permanently. Terminal state — cannot be resumed. */
  async abort(): Promise<void> {
    return this.engine.abort();
  }

  /**
   * Get current status, progress counters, and batch details.
   *
   * Returns both `status` and `state` (deprecated alias) for backward compatibility.
   */
  getStatus(): {
    status: JobStatus;
    /** @deprecated Use `status` instead. */
    state: JobStatus;
    progress: JobProgress;
    batches: readonly Batch[];
  } {
    return this.engine.getStatus();
  }

  /** Get all records that failed validation or processing. */
  async getFailedRecords(): Promise<readonly ProcessedRecord[]> {
    return this.engine.getFailedRecords();
  }

  /** Get records not yet processed. */
  getPendingRecords(): readonly ProcessedRecord[] {
    return this.engine.getPendingRecords();
  }

  /** Get the unique job identifier (UUID). */
  getJobId(): string {
    return this.engine.getJobId();
  }

  /**
   * Full import validation pipeline (synchronous):
   * 1. Alias resolution
   * 2. Apply transforms (array splitting, custom transforms, defaults)
   * 3. Schema validation (type checks, required fields, patterns, custom validators)
   * 4. Uniqueness checks (cross-batch, case-insensitive)
   *
   * DuplicateChecker (async) runs in the afterValidate hook — see `buildHooks()`.
   */
  private fullValidation(record: RawRecord): ValidationResult {
    // Step 1: Alias resolution
    const aliased = this.validator.resolveAliases(record);

    // Step 2: Apply transforms
    const transformed = this.validator.applyTransforms(aliased);

    // Step 3: Schema validation
    const result = this.validator.validate(transformed);

    if (!result.isValid && hasErrors(result.errors)) {
      return result;
    }

    // Step 4: Uniqueness checks
    const uniqueErrors = this.validator.validateUniqueness(transformed, this.seenUniqueValues);
    if (uniqueErrors.length > 0) {
      const allErrors: readonly ValidationError[] = [...result.errors, ...uniqueErrors];
      return invalidResult(allErrors);
    }

    // Return the transformed data so the core engine can use it as parsed data.
    return result.isValid ? validResult(transformed) : result;
  }
}
