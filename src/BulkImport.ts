import type { SchemaDefinition } from './domain/model/Schema.js';
import type { ImportProgress, PreviewResult } from './domain/model/ImportJob.js';
import type { ProcessedRecord } from './domain/model/Record.js';
import type { Batch } from './domain/model/Batch.js';
import type { ImportStatus } from './domain/model/ImportStatus.js';
import type { SourceParser } from './domain/ports/SourceParser.js';
import type { DataSource } from './domain/ports/DataSource.js';
import type { StateStore } from './domain/ports/StateStore.js';
import type { RecordProcessorFn } from './domain/ports/RecordProcessor.js';
import type { EventType, EventPayload } from './domain/events/DomainEvents.js';
import { ImportJobContext } from './application/ImportJobContext.js';
import { StartImport } from './application/usecases/StartImport.js';
import { PreviewImport } from './application/usecases/PreviewImport.js';
import { PauseImport } from './application/usecases/PauseImport.js';
import { ResumeImport } from './application/usecases/ResumeImport.js';
import { AbortImport } from './application/usecases/AbortImport.js';
import { GetImportStatus } from './application/usecases/GetImportStatus.js';
import { InMemoryStateStore } from './infrastructure/state/InMemoryStateStore.js';

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
}

/**
 * Facade that orchestrates the full import lifecycle: parse → validate → batch → process.
 *
 * Delegates each operation to a dedicated use case in `application/usecases/`.
 * Holds the shared `ImportJobContext` that all use cases operate on.
 *
 * @example
 * ```typescript
 * const importer = new BulkImport({ schema: { fields: [...] }, batchSize: 500 });
 * importer.from(new BufferSource(csv), new CsvParser());
 * await importer.start(async (record) => { await db.insert(record); });
 * ```
 */
export class BulkImport {
  private readonly ctx: ImportJobContext;

  constructor(config: BulkImportConfig) {
    this.ctx = new ImportJobContext(
      config.schema,
      config.batchSize ?? 100,
      config.continueOnError ?? false,
      config.maxConcurrentBatches ?? 1,
      config.stateStore ?? new InMemoryStateStore(),
    );
  }

  /**
   * Restore an import job from persisted state.
   *
   * Loads the job state from the configured `StateStore` and re-creates a
   * `BulkImport` instance positioned to resume processing. Only batches not
   * yet completed will be re-processed when `start()` is called again.
   *
   * The caller must provide a `BulkImportConfig` with the same schema and a
   * `stateStore` that contains the persisted state. Non-serializable fields
   * (`customValidator`, `transform`, `pattern`) must be re-provided in the
   * schema since they cannot be persisted.
   *
   * @param jobId - The job ID to restore.
   * @param config - Configuration with stateStore that holds the persisted state.
   * @returns A `BulkImport` instance ready to resume, or `null` if the job was not found.
   */
  static async restore(jobId: string, config: BulkImportConfig): Promise<BulkImport | null> {
    const stateStore = config.stateStore ?? new InMemoryStateStore();
    const jobState = await stateStore.getJobState(jobId);

    if (!jobState) return null;

    const instance = new BulkImport(config);
    instance.ctx.jobId = jobId;
    instance.ctx.status = jobState.status;
    instance.ctx.batches = [...jobState.batches];
    instance.ctx.totalRecords = jobState.totalRecords;
    instance.ctx.startedAt = jobState.startedAt;

    for (const batch of jobState.batches) {
      if (batch.status === 'COMPLETED') {
        instance.ctx.processedCount += batch.processedCount;
        instance.ctx.failedCount += batch.failedCount;
        instance.ctx.completedBatchIndices.add(batch.index);
      }
    }

    // Reset to CREATED so start() can be called
    instance.ctx.status = 'CREATED';

    return instance;
  }

  /**
   * Generate a CSV header template from a schema definition.
   *
   * Returns a single CSV line with all field names, useful for letting
   * frontends download a template that stays in sync with the schema.
   */
  static generateTemplate(schema: SchemaDefinition): string {
    return schema.fields.map((f) => f.name).join(',');
  }

  /** Set the data source and parser. Returns `this` for chaining. */
  from(source: DataSource, parser: SourceParser): this {
    this.ctx.source = source;
    this.ctx.parser = parser;
    return this;
  }

  /** Subscribe to a lifecycle event. Returns `this` for chaining. */
  on<T extends EventType>(type: T, handler: (event: EventPayload<T>) => void): this {
    this.ctx.eventBus.on(type, handler);
    return this;
  }

  /**
   * Validate a sample of records without processing them.
   *
   * Alias resolution and transforms are applied before validation.
   * Returns valid/invalid records, total sampled, and detected column names.
   */
  async preview(maxRecords = 10): Promise<PreviewResult> {
    return new PreviewImport(this.ctx).execute(maxRecords);
  }

  /**
   * Begin processing all records through the provided callback.
   *
   * Records are parsed lazily (streamed) and processed batch-by-batch.
   * When `maxConcurrentBatches > 1`, multiple batches are processed in parallel.
   * Memory is released after each batch completes.
   *
   * @throws Error if source/parser not configured or import already started.
   */
  async start(processor: RecordProcessorFn): Promise<void> {
    return new StartImport(this.ctx).execute(processor);
  }

  /** Pause processing after the current record completes. */
  async pause(): Promise<void> {
    return new PauseImport(this.ctx).execute();
  }

  /** Resume a paused import. */
  resume(): void {
    new ResumeImport(this.ctx).execute();
  }

  /** Cancel the import permanently. Terminal state — cannot be resumed. */
  async abort(): Promise<void> {
    return new AbortImport(this.ctx).execute();
  }

  /** Get current state, progress counters, and batch details. */
  getStatus(): { state: ImportStatus; progress: ImportProgress; batches: readonly Batch[] } {
    return new GetImportStatus(this.ctx).execute();
  }

  /** Get all records that failed validation or processing. Delegates to the configured StateStore. */
  async getFailedRecords(): Promise<readonly ProcessedRecord[]> {
    return new GetImportStatus(this.ctx).getFailedRecords();
  }

  /** Get records not yet processed. Returns `[]` in streaming mode (records are not retained). */
  getPendingRecords(): readonly ProcessedRecord[] {
    return new GetImportStatus(this.ctx).getPendingRecords();
  }

  /** Get the unique job identifier (UUID). */
  getJobId(): string {
    return new GetImportStatus(this.ctx).getJobId();
  }
}
