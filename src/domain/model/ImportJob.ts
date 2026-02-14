import type { SchemaDefinition } from './Schema.js';
import type { ImportStatus } from './ImportStatus.js';
import type { Batch } from './Batch.js';
import type { ProcessedRecord } from './Record.js';

export interface ImportJobConfig {
  readonly id?: string;
  readonly schema: SchemaDefinition;
  readonly batchSize: number;
  readonly maxConcurrentBatches?: number;
  readonly continueOnError?: boolean;
}

export interface ImportJobState {
  readonly id: string;
  readonly config: ImportJobConfig;
  readonly status: ImportStatus;
  readonly batches: readonly Batch[];
  readonly totalRecords: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export interface ImportProgress {
  readonly totalRecords: number;
  readonly processedRecords: number;
  readonly failedRecords: number;
  readonly pendingRecords: number;
  readonly percentage: number;
  readonly currentBatch: number;
  readonly totalBatches: number;
  readonly elapsedMs: number;
  readonly estimatedRemainingMs?: number;
}

export interface ImportSummary {
  readonly total: number;
  readonly processed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly elapsedMs: number;
}

export interface PreviewResult {
  readonly validRecords: readonly ProcessedRecord[];
  readonly invalidRecords: readonly ProcessedRecord[];
  readonly totalSampled: number;
  readonly columns: readonly string[];
}
