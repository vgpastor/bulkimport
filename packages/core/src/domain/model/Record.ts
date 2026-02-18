import type { ValidationError } from './ValidationResult.js';

/** Lifecycle status of a record during import processing. */
export type RecordStatus = 'valid' | 'invalid' | 'processed' | 'failed' | 'pending';

/** A key-value record as parsed from the source data. */
export interface RawRecord {
  readonly [key: string]: unknown;
}

/**
 * A record after alias resolution, transforms, and validation have been applied.
 *
 * Structurally identical to `RawRecord` but semantically distinct: values may
 * have been split (arrays), transformed, or had defaults applied. This is the
 * type received by the `RecordProcessorFn` callback.
 */
export type ParsedRecord = RawRecord;

/** A record enriched with validation/processing status and errors. */
export interface ProcessedRecord {
  /** Zero-based index of this record in the source data. */
  readonly index: number;
  /** Original key-value data as parsed from the source. */
  readonly raw: RawRecord;
  /** Transformed data after alias resolution and transforms. */
  readonly parsed: ParsedRecord;
  /** Current lifecycle status. */
  readonly status: RecordStatus;
  /** Validation errors (populated when `status` is `'invalid'`). */
  readonly errors: readonly ValidationError[];
  /** Error message from the processor callback (populated when `status` is `'failed'`). */
  readonly processingError?: string;
  /** Number of retry attempts made before final success or failure. Default: `0`. */
  readonly retryCount?: number;
}

/** Create a new record in `pending` status. */
export function createPendingRecord(index: number, raw: RawRecord): ProcessedRecord {
  return {
    index,
    raw,
    parsed: raw,
    status: 'pending',
    errors: [],
  };
}

/** Transition a record to `valid` status with transformed data. Optionally attach non-blocking warnings. */
export function markRecordValid(
  record: ProcessedRecord,
  parsed: RawRecord,
  warnings?: readonly ValidationError[],
): ProcessedRecord {
  return { ...record, parsed, status: 'valid', errors: warnings ?? [] };
}

/** Transition a record to `invalid` status with validation errors. */
export function markRecordInvalid(record: ProcessedRecord, errors: readonly ValidationError[]): ProcessedRecord {
  return { ...record, status: 'invalid', errors };
}

/** Transition a record to `failed` status with a processing error. */
export function markRecordFailed(record: ProcessedRecord, error: string): ProcessedRecord {
  return { ...record, status: 'failed', processingError: error };
}

/** Check whether every value in a raw record is empty (`undefined`, `null`, or `''`). */
export function isEmptyRow(record: RawRecord): boolean {
  return Object.values(record).every((v) => v === undefined || v === null || v === '');
}
