import { describe, it, expect } from 'vitest';
import * as RecordMapper from '../../src/mappers/RecordMapper.js';
import type { ProcessedRecord } from '@batchactions/core';

function createSampleRecord(overrides?: Partial<ProcessedRecord>): ProcessedRecord {
  return {
    index: 0,
    raw: { email: 'test@example.com', name: 'Test User' },
    parsed: { email: 'test@example.com', name: 'Test User' },
    status: 'processed',
    errors: [],
    ...overrides,
  };
}

describe('RecordMapper', () => {
  describe('toRow', () => {
    it('should convert a processed record to a database row', () => {
      const record = createSampleRecord();
      const row = RecordMapper.toRow('job-001', 'batch-001', record);

      expect(row.jobId).toBe('job-001');
      expect(row.batchId).toBe('batch-001');
      expect(row.recordIndex).toBe(0);
      expect(row.status).toBe('processed');
      expect(row.raw).toEqual({ email: 'test@example.com', name: 'Test User' });
      expect(row.parsed).toEqual({ email: 'test@example.com', name: 'Test User' });
      expect(row.errors).toEqual([]);
      expect(row.processingError).toBeNull();
    });

    it('should include processingError when present', () => {
      const record = createSampleRecord({ status: 'failed', processingError: 'Connection timeout' });
      const row = RecordMapper.toRow('job-001', 'batch-001', record);

      expect(row.status).toBe('failed');
      expect(row.processingError).toBe('Connection timeout');
    });

    it('should include validation errors', () => {
      const record = createSampleRecord({
        status: 'invalid',
        errors: [
          { field: 'email', message: 'Invalid email', code: 'TYPE_MISMATCH' },
          { field: 'name', message: 'Required', code: 'REQUIRED' },
        ],
      });
      const row = RecordMapper.toRow('job-001', 'batch-001', record);

      expect(row.errors).toHaveLength(2);
    });
  });

  describe('toDomain', () => {
    it('should reconstruct a record from a database row', () => {
      const original = createSampleRecord();
      const row = RecordMapper.toRow('job-001', 'batch-001', original);
      const restored = RecordMapper.toDomain(row);

      expect(restored.index).toBe(0);
      expect(restored.status).toBe('processed');
      expect(restored.raw).toEqual(original.raw);
      expect(restored.parsed).toEqual(original.parsed);
      expect(restored.errors).toEqual([]);
      expect(restored.processingError).toBeUndefined();
    });

    it('should include processingError when not null', () => {
      const record = createSampleRecord({ status: 'failed', processingError: 'DB error' });
      const row = RecordMapper.toRow('job-001', 'batch-001', record);
      const restored = RecordMapper.toDomain(row);

      expect(restored.processingError).toBe('DB error');
    });

    it('should handle invalid records with errors', () => {
      const record = createSampleRecord({
        status: 'invalid',
        errors: [{ field: 'email', message: 'Invalid format', code: 'TYPE_MISMATCH', value: 'not-email' }],
      });
      const row = RecordMapper.toRow('job-001', 'batch-001', record);
      const restored = RecordMapper.toDomain(row);

      expect(restored.status).toBe('invalid');
      expect(restored.errors).toHaveLength(1);
      expect(restored.errors[0]!.field).toBe('email');
      expect(restored.errors[0]!.value).toBe('not-email');
    });
  });

  describe('roundtrip', () => {
    it('should preserve all data through toRow → toDomain', () => {
      const original = createSampleRecord();
      const restored = RecordMapper.toDomain(RecordMapper.toRow('job-001', 'batch-001', original));

      expect(restored.index).toBe(original.index);
      expect(restored.status).toBe(original.status);
      expect(restored.raw).toEqual(original.raw);
      expect(restored.parsed).toEqual(original.parsed);
      expect(restored.errors).toEqual(original.errors);
    });

    it('should preserve failed record with error', () => {
      const original = createSampleRecord({ status: 'failed', processingError: 'Timeout' });
      const restored = RecordMapper.toDomain(RecordMapper.toRow('job-001', 'batch-001', original));

      expect(restored.status).toBe('failed');
      expect(restored.processingError).toBe('Timeout');
    });

    it('should preserve pending status', () => {
      const original = createSampleRecord({ status: 'pending' });
      const restored = RecordMapper.toDomain(RecordMapper.toRow('job-001', 'batch-001', original));

      expect(restored.status).toBe('pending');
    });
  });

  describe('toDomain with JSON-as-string (MySQL driver)', () => {
    it('should parse raw when returned as a JSON string', () => {
      const record = createSampleRecord();
      const row = RecordMapper.toRow('job-001', 'batch-001', record);
      (row as Record<string, unknown>)['raw'] = JSON.stringify(row.raw);

      const restored = RecordMapper.toDomain(row);
      expect(restored.raw).toEqual({ email: 'test@example.com', name: 'Test User' });
    });

    it('should parse parsed when returned as a JSON string', () => {
      const record = createSampleRecord();
      const row = RecordMapper.toRow('job-001', 'batch-001', record);
      (row as Record<string, unknown>)['parsed'] = JSON.stringify(row.parsed);

      const restored = RecordMapper.toDomain(row);
      expect(restored.parsed).toEqual({ email: 'test@example.com', name: 'Test User' });
    });

    it('should parse errors when returned as a JSON string', () => {
      const record = createSampleRecord({
        status: 'invalid',
        errors: [{ field: 'email', message: 'Invalid', code: 'TYPE_MISMATCH', value: 'bad' }],
      });
      const row = RecordMapper.toRow('job-001', 'batch-001', record);
      (row as Record<string, unknown>)['errors'] = JSON.stringify(row.errors);

      const restored = RecordMapper.toDomain(row);
      expect(restored.errors).toHaveLength(1);
      expect(restored.errors[0]!.field).toBe('email');
    });

    it('should handle all JSON fields as strings simultaneously', () => {
      const record = createSampleRecord({
        status: 'invalid',
        errors: [{ field: 'name', message: 'Required', code: 'REQUIRED' }],
      });
      const row = RecordMapper.toRow('job-001', 'batch-001', record);
      (row as Record<string, unknown>)['raw'] = JSON.stringify(row.raw);
      (row as Record<string, unknown>)['parsed'] = JSON.stringify(row.parsed);
      (row as Record<string, unknown>)['errors'] = JSON.stringify(row.errors);

      const restored = RecordMapper.toDomain(row);
      expect(restored.raw).toEqual({ email: 'test@example.com', name: 'Test User' });
      expect(restored.parsed).toEqual({ email: 'test@example.com', name: 'Test User' });
      expect(restored.errors).toHaveLength(1);
    });
  });
});
