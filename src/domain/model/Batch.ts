import type { BatchStatus } from './BatchStatus.js';
import type { ProcessedRecord } from './Record.js';

/** A group of records processed together as a unit. */
export interface Batch {
  /** Unique batch identifier (UUID). */
  readonly id: string;
  /** Zero-based batch index within the import job. */
  readonly index: number;
  /** Current processing status. */
  readonly status: BatchStatus;
  /** Records in this batch. Cleared after processing to release memory. */
  readonly records: readonly ProcessedRecord[];
  /** Number of records successfully processed. */
  readonly processedCount: number;
  /** Number of records that failed validation or processing. */
  readonly failedCount: number;
}

/** Create a new batch in `PENDING` status. */
export function createBatch(id: string, index: number, records: readonly ProcessedRecord[]): Batch {
  return {
    id,
    index,
    status: 'PENDING',
    records,
    processedCount: 0,
    failedCount: 0,
  };
}

/** Clear record data from a batch to release memory. */
export function clearBatchRecords(batch: Batch): Batch {
  return { ...batch, records: [] };
}
