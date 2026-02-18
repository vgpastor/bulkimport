import type { ProcessedRecord, RawRecord, ValidationError } from '@batchactions/core';
import type { RecordRow } from '../models/RecordModel.js';
import { parseJson } from '../utils/parseJson.js';

export function toRow(jobId: string, batchId: string, record: ProcessedRecord): RecordRow {
  return {
    jobId,
    batchId,
    recordIndex: record.index,
    status: record.status,
    raw: record.raw,
    parsed: record.parsed,
    errors: record.errors,
    processingError: record.processingError ?? null,
  };
}

export function toDomain(row: RecordRow): ProcessedRecord {
  const result: ProcessedRecord = {
    index: row.recordIndex,
    raw: parseJson(row.raw) as RawRecord,
    parsed: parseJson(row.parsed) as RawRecord,
    status: row.status as ProcessedRecord['status'],
    errors: parseJson(row.errors) as readonly ValidationError[],
  };

  if (row.processingError !== null) {
    return { ...result, processingError: row.processingError };
  }

  return result;
}
