import type { ProcessedRecord } from '@batchactions/core';

/** Result of previewing a sample of records against the schema. */
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
