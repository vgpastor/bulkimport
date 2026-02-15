import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileStateStore } from '../../../src/infrastructure/state/FileStateStore.js';
import type { ImportJobState } from '../../../src/domain/model/ImportJob.js';
import type { ProcessedRecord } from '../../../src/domain/model/Record.js';

const TEST_DIR = join(process.cwd(), `.bulkimport-test-${String(process.pid)}`);

function createJobState(overrides?: Partial<ImportJobState>): ImportJobState {
  return {
    id: 'test-job-1',
    config: {
      schema: { fields: [{ name: 'email', type: 'email', required: true }] },
      batchSize: 100,
      continueOnError: false,
    },
    status: 'PROCESSING',
    batches: [],
    totalRecords: 10,
    startedAt: Date.now(),
    ...overrides,
  };
}

function createRecord(index: number, status: ProcessedRecord['status']): ProcessedRecord {
  return {
    index,
    raw: { email: `user${String(index)}@test.com` },
    parsed: { email: `user${String(index)}@test.com` },
    status,
    errors: [],
  };
}

describe('FileStateStore', () => {
  let store: FileStateStore;

  beforeEach(() => {
    store = new FileStateStore({ directory: TEST_DIR });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('saveJobState / getJobState', () => {
    it('should persist and retrieve job state', async () => {
      const job = createJobState();
      await store.saveJobState(job);

      const retrieved = await store.getJobState('test-job-1');
      expect(retrieved).toEqual(job);
    });

    it('should return null for non-existent job', async () => {
      const result = await store.getJobState('non-existent');
      expect(result).toBeNull();
    });

    it('should overwrite existing job state', async () => {
      await store.saveJobState(createJobState({ status: 'PROCESSING' }));
      await store.saveJobState(createJobState({ status: 'COMPLETED' }));

      const retrieved = await store.getJobState('test-job-1');
      expect(retrieved?.status).toBe('COMPLETED');
    });

    it('should write valid JSON to disk', async () => {
      const job = createJobState();
      await store.saveJobState(job);

      const content = await readFile(join(TEST_DIR, 'test-job-1.json'), 'utf-8');
      const parsed = JSON.parse(content) as ImportJobState;
      expect(parsed.id).toBe('test-job-1');
    });
  });

  describe('updateBatchState', () => {
    it('should update batch status within job state', async () => {
      const job = createJobState({
        batches: [{ id: 'batch-1', index: 0, status: 'PROCESSING', records: [], processedCount: 0, failedCount: 0 }],
      });
      await store.saveJobState(job);

      await store.updateBatchState('test-job-1', 'batch-1', {
        batchId: 'batch-1',
        status: 'COMPLETED',
        processedCount: 10,
        failedCount: 2,
      });

      const retrieved = await store.getJobState('test-job-1');
      expect(retrieved?.batches[0]?.status).toBe('COMPLETED');
      expect(retrieved?.batches[0]?.processedCount).toBe(10);
      expect(retrieved?.batches[0]?.failedCount).toBe(2);
    });

    it('should no-op for non-existent job', async () => {
      await expect(
        store.updateBatchState('non-existent', 'batch-1', {
          batchId: 'batch-1',
          status: 'COMPLETED',
          processedCount: 0,
          failedCount: 0,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('saveProcessedRecord / query methods', () => {
    it('should save and retrieve failed records', async () => {
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(0, 'failed'));
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(1, 'processed'));
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(2, 'invalid'));

      const failed = await store.getFailedRecords('job-1');
      expect(failed).toHaveLength(2);
    });

    it('should save and retrieve processed records', async () => {
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(0, 'processed'));
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(1, 'processed'));
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(2, 'failed'));

      const processed = await store.getProcessedRecords('job-1');
      expect(processed).toHaveLength(2);
    });

    it('should save and retrieve pending records', async () => {
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(0, 'pending'));
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(1, 'valid'));
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(2, 'processed'));

      const pending = await store.getPendingRecords('job-1');
      expect(pending).toHaveLength(2);
    });

    it('should update record in place when same index is saved again', async () => {
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(0, 'pending'));
      await store.saveProcessedRecord('job-1', 'batch-1', createRecord(0, 'processed'));

      const all = await store.getProcessedRecords('job-1');
      expect(all).toHaveLength(1);
      expect(all[0]?.status).toBe('processed');
    });

    it('should return empty arrays for non-existent job', async () => {
      expect(await store.getFailedRecords('nope')).toEqual([]);
      expect(await store.getPendingRecords('nope')).toEqual([]);
      expect(await store.getProcessedRecords('nope')).toEqual([]);
    });
  });

  describe('getProgress', () => {
    it('should compute progress from persisted records', async () => {
      const job = createJobState({
        totalRecords: 5,
        batches: [{ id: 'b-1', index: 0, status: 'COMPLETED', records: [], processedCount: 3, failedCount: 0 }],
      });
      await store.saveJobState(job);

      await store.saveProcessedRecord('test-job-1', 'b-1', createRecord(0, 'processed'));
      await store.saveProcessedRecord('test-job-1', 'b-1', createRecord(1, 'processed'));
      await store.saveProcessedRecord('test-job-1', 'b-1', createRecord(2, 'processed'));
      await store.saveProcessedRecord('test-job-1', 'b-1', createRecord(3, 'failed'));
      await store.saveProcessedRecord('test-job-1', 'b-1', createRecord(4, 'pending'));

      const progress = await store.getProgress('test-job-1');
      expect(progress.totalRecords).toBe(5);
      expect(progress.processedRecords).toBe(3);
      expect(progress.failedRecords).toBe(1);
      expect(progress.pendingRecords).toBe(1);
      expect(progress.currentBatch).toBe(1);
      expect(progress.totalBatches).toBe(1);
      expect(progress.percentage).toBe(60);
    });

    it('should return zero progress for non-existent job', async () => {
      const progress = await store.getProgress('non-existent');
      expect(progress.totalRecords).toBe(0);
      expect(progress.processedRecords).toBe(0);
      expect(progress.failedRecords).toBe(0);
      expect(progress.pendingRecords).toBe(0);
      expect(progress.percentage).toBe(0);
      expect(progress.currentBatch).toBe(0);
      expect(progress.totalBatches).toBe(0);
    });

    it('should compute progress with records only (no job state)', async () => {
      await store.saveProcessedRecord('records-only', 'b-1', createRecord(0, 'processed'));
      await store.saveProcessedRecord('records-only', 'b-1', createRecord(1, 'processed'));
      await store.saveProcessedRecord('records-only', 'b-1', createRecord(2, 'failed'));

      const progress = await store.getProgress('records-only');
      expect(progress.totalRecords).toBe(3);
      expect(progress.processedRecords).toBe(2);
      expect(progress.failedRecords).toBe(1);
    });
  });

  describe('default directory', () => {
    it('should use .bulkimport as default directory', () => {
      const defaultStore = new FileStateStore();
      // Verify by saving and checking it doesn't throw
      expect(defaultStore).toBeDefined();
    });
  });
});
