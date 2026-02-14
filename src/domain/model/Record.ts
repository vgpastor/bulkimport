import type { ValidationError } from './ValidationResult.js';

export type RecordStatus = 'valid' | 'invalid' | 'processed' | 'failed' | 'pending';

export interface RawRecord {
  readonly [key: string]: unknown;
}

export interface ProcessedRecord {
  readonly index: number;
  readonly raw: RawRecord;
  readonly parsed: RawRecord;
  readonly status: RecordStatus;
  readonly errors: readonly ValidationError[];
  readonly processingError?: string;
}

export function createPendingRecord(index: number, raw: RawRecord): ProcessedRecord {
  return {
    index,
    raw,
    parsed: raw,
    status: 'pending',
    errors: [],
  };
}

export function markRecordValid(record: ProcessedRecord, parsed: RawRecord): ProcessedRecord {
  return { ...record, parsed, status: 'valid', errors: [] };
}

export function markRecordInvalid(record: ProcessedRecord, errors: readonly ValidationError[]): ProcessedRecord {
  return { ...record, status: 'invalid', errors };
}

export function markRecordProcessed(record: ProcessedRecord): ProcessedRecord {
  return { ...record, status: 'processed' };
}

export function markRecordFailed(record: ProcessedRecord, error: string): ProcessedRecord {
  return { ...record, status: 'failed', processingError: error };
}
