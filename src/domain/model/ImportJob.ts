import type { SchemaDefinition } from './Schema.js';
import type { ImportStatus } from './ImportStatus.js';
import type { Batch } from './Batch.js';
import type { ProcessedRecord } from './Record.js';

/** Configuration snapshot stored as part of the job state. */
export interface ImportJobConfig {
  readonly id?: string;
  readonly schema: SchemaDefinition;
  readonly batchSize: number;
  readonly maxConcurrentBatches?: number;
  readonly continueOnError?: boolean;
}

/** Serialisable state of an import job (for persistence via StateStore). */
export interface ImportJobState {
  readonly id: string;
  readonly config: ImportJobConfig;
  readonly status: ImportStatus;
  readonly batches: readonly Batch[];
  readonly totalRecords: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  /** When `true`, this job uses distributed batch processing. */
  readonly distributed?: boolean;
}

/** Real-time progress counters for an in-flight import. */
export interface ImportProgress {
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

/** Final summary emitted with the `import:completed` event. */
export interface ImportSummary {
  readonly total: number;
  readonly processed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly elapsedMs: number;
}

/** Result of calling `preview()` — contains sampled records and detected columns. */
export interface PreviewResult {
  /** Records that passed schema validation. */
  readonly validRecords: readonly ProcessedRecord[];
  /** Records that failed schema validation. */
  readonly invalidRecords: readonly ProcessedRecord[];
  /** Total number of records sampled from the source. */
  readonly totalSampled: number;
  /** Detected column names (after alias resolution). */
  readonly columns: readonly string[];
}
