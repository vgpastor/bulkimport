import { describe, it, expect } from 'vitest';
import * as JobMapper from '../../src/mappers/JobMapper.js';
import type { ImportJobState } from '@bulkimport/core';

function createSampleJobState(overrides?: Partial<ImportJobState>): ImportJobState {
  return {
    id: 'job-001',
    config: {
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: false, aliases: ['fullName', 'nombre'] },
          {
            name: 'tags',
            type: 'array',
            required: false,
            separator: ';',
            defaultValue: [],
          },
          {
            name: 'custom',
            type: 'custom',
            required: false,
            customValidator: () => ({ valid: true }),
            transform: (v: unknown) => String(v).toUpperCase(),
            pattern: /^[A-Z]+$/,
          },
        ],
      },
      batchSize: 100,
      continueOnError: true,
    },
    status: 'PROCESSING',
    batches: [
      { id: 'b1', index: 0, status: 'COMPLETED', records: [], processedCount: 10, failedCount: 2 },
      { id: 'b2', index: 1, status: 'PENDING', records: [], processedCount: 0, failedCount: 0 },
    ],
    totalRecords: 50,
    startedAt: 1700000000000,
    ...overrides,
  };
}

describe('JobMapper', () => {
  describe('toRow', () => {
    it('should serialize job state to a database row', () => {
      const state = createSampleJobState();
      const row = JobMapper.toRow(state);

      expect(row.id).toBe('job-001');
      expect(row.status).toBe('PROCESSING');
      expect(row.totalRecords).toBe(50);
      expect(row.startedAt).toBe(1700000000000);
      expect(row.completedAt).toBeNull();
    });

    it('should strip non-serializable fields from config', () => {
      const state = createSampleJobState();
      const row = JobMapper.toRow(state);
      const config = row.config as { schema: { fields: Array<Record<string, unknown>> } };

      const customField = config.schema.fields.find((f) => f['name'] === 'custom');
      expect(customField).toBeDefined();
      expect(customField!['customValidator']).toBeUndefined();
      expect(customField!['transform']).toBeUndefined();
      expect(customField!['pattern']).toBeUndefined();
    });

    it('should preserve serializable field properties', () => {
      const state = createSampleJobState();
      const row = JobMapper.toRow(state);
      const config = row.config as { schema: { fields: Array<Record<string, unknown>> } };

      const emailField = config.schema.fields.find((f) => f['name'] === 'email');
      expect(emailField).toEqual({ name: 'email', type: 'email', required: true });

      const nameField = config.schema.fields.find((f) => f['name'] === 'name');
      expect(nameField).toEqual({
        name: 'name',
        type: 'string',
        required: false,
        aliases: ['fullName', 'nombre'],
      });

      const tagsField = config.schema.fields.find((f) => f['name'] === 'tags');
      expect(tagsField).toEqual({
        name: 'tags',
        type: 'array',
        required: false,
        separator: ';',
        defaultValue: [],
      });
    });

    it('should serialize batches without records', () => {
      const state = createSampleJobState();
      const row = JobMapper.toRow(state);
      const batches = row.batches as Array<Record<string, unknown>>;

      expect(batches).toHaveLength(2);
      expect(batches[0]).toEqual({
        id: 'b1',
        index: 0,
        status: 'COMPLETED',
        records: [],
        processedCount: 10,
        failedCount: 2,
      });
    });
  });

  describe('toDomain', () => {
    it('should reconstruct job state from a database row', () => {
      const original = createSampleJobState();
      const row = JobMapper.toRow(original);
      const restored = JobMapper.toDomain(row);

      expect(restored.id).toBe(original.id);
      expect(restored.status).toBe(original.status);
      expect(restored.totalRecords).toBe(original.totalRecords);
      expect(restored.startedAt).toBe(original.startedAt);
      expect(restored.completedAt).toBeUndefined();
    });

    it('should handle completedAt when present', () => {
      const original = createSampleJobState({ completedAt: 1700001000000 });
      const row = JobMapper.toRow(original);
      const restored = JobMapper.toDomain(row);

      expect(restored.completedAt).toBe(1700001000000);
    });

    it('should handle job without startedAt or completedAt', () => {
      const original = createSampleJobState();
      const row = JobMapper.toRow(original);
      row.startedAt = null;
      row.completedAt = null;
      const restored = JobMapper.toDomain(row);

      expect(restored.startedAt).toBeUndefined();
      expect(restored.completedAt).toBeUndefined();
    });

    it('should convert BIGINT string values back to numbers', () => {
      const row = JobMapper.toRow(createSampleJobState({ startedAt: 1700000000000, completedAt: 1700001000000 }));
      // Simulate what SQLite does — BIGINT comes back as string
      (row as Record<string, unknown>)['startedAt'] = '1700000000000';
      (row as Record<string, unknown>)['completedAt'] = '1700001000000';
      const restored = JobMapper.toDomain(row);

      expect(restored.startedAt).toBe(1700000000000);
      expect(restored.completedAt).toBe(1700001000000);
    });

    it('should preserve batch structure', () => {
      const original = createSampleJobState();
      const row = JobMapper.toRow(original);
      const restored = JobMapper.toDomain(row);

      expect(restored.batches).toHaveLength(2);
      expect(restored.batches[0]!.id).toBe('b1');
      expect(restored.batches[0]!.status).toBe('COMPLETED');
    });
  });

  describe('roundtrip', () => {
    it('should preserve serializable data through toRow → toDomain', () => {
      const original = createSampleJobState({ startedAt: 1700000000000, completedAt: 1700001000000 });
      const restored = JobMapper.toDomain(JobMapper.toRow(original));

      expect(restored.id).toBe(original.id);
      expect(restored.status).toBe(original.status);
      expect(restored.totalRecords).toBe(original.totalRecords);
      expect(restored.startedAt).toBe(original.startedAt);
      expect(restored.completedAt).toBe(original.completedAt);
      expect(restored.batches).toHaveLength(original.batches.length);
      expect(restored.config.batchSize).toBe(original.config.batchSize);
      expect(restored.config.continueOnError).toBe(original.config.continueOnError);
      expect(restored.config.schema.fields).toHaveLength(original.config.schema.fields.length);
    });
  });

  describe('toDomain with JSON-as-string (MySQL driver)', () => {
    it('should parse batches when returned as a JSON string', () => {
      const original = createSampleJobState();
      const row = JobMapper.toRow(original);
      // Simulate MySQL returning JSON columns as strings
      (row as Record<string, unknown>)['batches'] = JSON.stringify(row.batches);

      const restored = JobMapper.toDomain(row);

      expect(restored.batches).toHaveLength(2);
      expect(restored.batches[0]!.id).toBe('b1');
      expect(restored.batches[0]!.status).toBe('COMPLETED');
      expect(restored.batches[1]!.id).toBe('b2');
    });

    it('should parse config when returned as a JSON string', () => {
      const original = createSampleJobState();
      const row = JobMapper.toRow(original);
      // Simulate MySQL returning JSON columns as strings
      (row as Record<string, unknown>)['config'] = JSON.stringify(row.config);

      const restored = JobMapper.toDomain(row);

      expect(restored.config.batchSize).toBe(100);
      expect(restored.config.continueOnError).toBe(true);
      expect(restored.config.schema.fields).toHaveLength(4);
    });

    it('should handle both config and batches as strings simultaneously', () => {
      const original = createSampleJobState();
      const row = JobMapper.toRow(original);
      (row as Record<string, unknown>)['config'] = JSON.stringify(row.config);
      (row as Record<string, unknown>)['batches'] = JSON.stringify(row.batches);

      const restored = JobMapper.toDomain(row);

      expect(restored.config.batchSize).toBe(100);
      expect(restored.batches).toHaveLength(2);
    });
  });
});
