import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize } from 'sequelize';
import { SQLite3Wrapper } from '../better-sqlite3-adapter.js';
import { SequelizeStateStore } from '../../src/SequelizeStateStore.js';
import type { JobState, ProcessedRecord } from '@batchactions/core';
import fs from 'fs';
import path from 'path';
import os from 'os';

function createJobState(overrides?: Partial<JobState>): JobState {
  return {
    id: 'job-001',
    config: {
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: false },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    },
    status: 'PROCESSING',
    batches: [
      { id: 'b1', index: 0, status: 'COMPLETED', records: [], processedCount: 5, failedCount: 1 },
      { id: 'b2', index: 1, status: 'PENDING', records: [], processedCount: 0, failedCount: 0 },
    ],
    totalRecords: 20,
    startedAt: 1700000000000,
    ...overrides,
  };
}

function createRecord(
  index: number,
  status: ProcessedRecord['status'],
  extras?: Partial<ProcessedRecord>,
): ProcessedRecord {
  return {
    index,
    raw: { email: `user${String(index)}@test.com`, name: `User ${String(index)}` },
    parsed: { email: `user${String(index)}@test.com`, name: `User ${String(index)}` },
    status,
    errors: [],
    ...extras,
  };
}

describe('SequelizeStateStore', () => {
  let sequelize: Sequelize;
  let store: SequelizeStateStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-seq-${String(Date.now())}-${String(Math.random())}.sqlite`);
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: dbPath,
      logging: false,
      dialectModule: { Database: SQLite3Wrapper },
      pool: {
        max: 1,
        min: 1,
        idle: 30000,
        acquire: 60000,
        evict: 30000,
      },
    });
    store = new SequelizeStateStore(sequelize);
    await store.initialize();
  });

  afterEach(async () => {
    try {
      await sequelize.close();
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch {
      // ignore
    }
  });

  describe('initialize', () => {
    it('should create tables without error', async () => {
      const freshSequelize = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false,
        dialectModule: { Database: SQLite3Wrapper },
      });
      const freshStore = new SequelizeStateStore(freshSequelize);
      await expect(freshStore.initialize()).resolves.toBeUndefined();
    });

    it('should be idempotent', async () => {
      await expect(store.initialize()).resolves.toBeUndefined();
      await expect(store.initialize()).resolves.toBeUndefined();
    });
  });

  describe('saveJobState + getJobState', () => {
    it('should persist and retrieve a job state', async () => {
      const job = createJobState();
      await store.saveJobState(job);
      const restored = await store.getJobState('job-001');

      expect(restored).not.toBeNull();
      expect(restored!.id).toBe('job-001');
      expect(restored!.status).toBe('PROCESSING');
      expect(restored!.totalRecords).toBe(20);
      expect(restored!.startedAt).toBe(1700000000000);
      expect(restored!.completedAt).toBeUndefined();
    });

    it('should return null for non-existent job', async () => {
      const result = await store.getJobState('non-existent');
      expect(result).toBeNull();
    });

    it('should upsert on second save', async () => {
      const job = createJobState();
      await store.saveJobState(job);
      await store.saveJobState({ ...job, status: 'COMPLETED', completedAt: 1700001000000 });

      const restored = await store.getJobState('job-001');
      expect(restored!.status).toBe('COMPLETED');
      expect(restored!.completedAt).toBe(1700001000000);
    });

    it('should preserve schema config (minus non-serializable fields)', async () => {
      const job = createJobState();
      await store.saveJobState(job);
      const restored = await store.getJobState('job-001');

      const schema = restored!.config.schema as { fields: readonly { name: string }[] };
      expect(schema.fields).toHaveLength(2);
      expect(schema.fields[0]!.name).toBe('email');
      expect(restored!.config.batchSize).toBe(10);
      expect(restored!.config.continueOnError).toBe(true);
    });

    it('should preserve batch state in JSON', async () => {
      const job = createJobState();
      await store.saveJobState(job);
      const restored = await store.getJobState('job-001');

      expect(restored!.batches).toHaveLength(2);
      expect(restored!.batches[0]!.id).toBe('b1');
      expect(restored!.batches[0]!.status).toBe('COMPLETED');
      expect(restored!.batches[0]!.processedCount).toBe(5);
    });
  });

  describe('updateBatchState', () => {
    it('should update a specific batch within the job', async () => {
      const job = createJobState();
      await store.saveJobState(job);

      await store.updateBatchState('job-001', 'b2', {
        batchId: 'b2',
        status: 'COMPLETED',
        processedCount: 8,
        failedCount: 2,
      });

      const restored = await store.getJobState('job-001');
      const batch2 = restored!.batches[1]!;
      expect(batch2.status).toBe('COMPLETED');
      expect(batch2.processedCount).toBe(8);
      expect(batch2.failedCount).toBe(2);
    });

    it('should not modify other batches', async () => {
      const job = createJobState();
      await store.saveJobState(job);

      await store.updateBatchState('job-001', 'b2', {
        batchId: 'b2',
        status: 'PROCESSING',
        processedCount: 3,
        failedCount: 0,
      });

      const restored = await store.getJobState('job-001');
      const batch1 = restored!.batches[0]!;
      expect(batch1.status).toBe('COMPLETED');
      expect(batch1.processedCount).toBe(5);
    });

    it('should do nothing for non-existent job', async () => {
      await expect(
        store.updateBatchState('non-existent', 'b1', {
          batchId: 'b1',
          status: 'COMPLETED',
          processedCount: 0,
          failedCount: 0,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('saveProcessedRecord', () => {
    it('should save a record', async () => {
      const record = createRecord(0, 'processed');
      await store.saveProcessedRecord('job-001', 'b1', record);

      const processed = await store.getProcessedRecords('job-001');
      expect(processed).toHaveLength(1);
      expect(processed[0]!.index).toBe(0);
      expect(processed[0]!.status).toBe('processed');
    });

    it('should upsert on duplicate (same jobId + recordIndex)', async () => {
      const record = createRecord(0, 'valid');
      await store.saveProcessedRecord('job-001', 'b1', record);

      const updated = { ...record, status: 'processed' as const };
      await store.saveProcessedRecord('job-001', 'b1', updated);

      const processed = await store.getProcessedRecords('job-001');
      expect(processed).toHaveLength(1);
      expect(processed[0]!.status).toBe('processed');
    });
  });

  describe('getFailedRecords', () => {
    it('should return records with failed or invalid status', async () => {
      await store.saveProcessedRecord('job-001', 'b1', createRecord(0, 'processed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(1, 'failed', { processingError: 'DB error' }));
      await store.saveProcessedRecord(
        'job-001',
        'b1',
        createRecord(2, 'invalid', {
          errors: [{ field: 'email', message: 'Invalid', code: 'TYPE_MISMATCH' }],
        }),
      );
      await store.saveProcessedRecord('job-001', 'b1', createRecord(3, 'processed'));

      const failed = await store.getFailedRecords('job-001');
      expect(failed).toHaveLength(2);
      expect(failed[0]!.index).toBe(1);
      expect(failed[0]!.status).toBe('failed');
      expect(failed[1]!.index).toBe(2);
      expect(failed[1]!.status).toBe('invalid');
    });

    it('should return empty array when no failures', async () => {
      await store.saveProcessedRecord('job-001', 'b1', createRecord(0, 'processed'));
      const failed = await store.getFailedRecords('job-001');
      expect(failed).toHaveLength(0);
    });
  });

  describe('getPendingRecords', () => {
    it('should return records with pending or valid status', async () => {
      await store.saveProcessedRecord('job-001', 'b1', createRecord(0, 'pending'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(1, 'valid'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(2, 'processed'));

      const pending = await store.getPendingRecords('job-001');
      expect(pending).toHaveLength(2);
      expect(pending[0]!.status).toBe('pending');
      expect(pending[1]!.status).toBe('valid');
    });
  });

  describe('getProcessedRecords', () => {
    it('should return only processed records', async () => {
      await store.saveProcessedRecord('job-001', 'b1', createRecord(0, 'processed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(1, 'failed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(2, 'processed'));

      const processed = await store.getProcessedRecords('job-001');
      expect(processed).toHaveLength(2);
      expect(processed[0]!.index).toBe(0);
      expect(processed[1]!.index).toBe(2);
    });

    it('should return records ordered by index', async () => {
      await store.saveProcessedRecord('job-001', 'b1', createRecord(5, 'processed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(2, 'processed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(8, 'processed'));

      const processed = await store.getProcessedRecords('job-001');
      expect(processed.map((r) => r.index)).toEqual([2, 5, 8]);
    });
  });

  describe('getProgress', () => {
    it('should calculate progress from stored records', async () => {
      const job = createJobState({ totalRecords: 10 });
      await store.saveJobState(job);

      await store.saveProcessedRecord('job-001', 'b1', createRecord(0, 'processed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(1, 'processed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(2, 'failed'));
      await store.saveProcessedRecord('job-001', 'b1', createRecord(3, 'invalid'));

      const progress = await store.getProgress('job-001');
      expect(progress.totalRecords).toBe(10);
      expect(progress.processedRecords).toBe(2);
      expect(progress.failedRecords).toBe(2);
      expect(progress.pendingRecords).toBe(6);
      expect(progress.percentage).toBe(40);
    });

    it('should return zero progress for non-existent job', async () => {
      const progress = await store.getProgress('non-existent');
      expect(progress.totalRecords).toBe(0);
      expect(progress.processedRecords).toBe(0);
      expect(progress.percentage).toBe(0);
    });

    it('should count completed batches', async () => {
      const job = createJobState();
      await store.saveJobState(job);

      const progress = await store.getProgress('job-001');
      expect(progress.currentBatch).toBe(1);
      expect(progress.totalBatches).toBe(2);
    });
  });

  describe('isolation between jobs', () => {
    it('should not mix records from different jobs', async () => {
      await store.saveProcessedRecord('job-001', 'b1', createRecord(0, 'processed'));
      await store.saveProcessedRecord('job-002', 'b1', createRecord(0, 'failed'));
      await store.saveProcessedRecord('job-002', 'b1', createRecord(1, 'processed'));

      const processed1 = await store.getProcessedRecords('job-001');
      expect(processed1).toHaveLength(1);

      const failed2 = await store.getFailedRecords('job-002');
      expect(failed2).toHaveLength(1);

      const processed2 = await store.getProcessedRecords('job-002');
      expect(processed2).toHaveLength(1);
    });
  });
});
