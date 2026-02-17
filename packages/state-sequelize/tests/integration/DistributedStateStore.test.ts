import { describe, it, expect, beforeEach } from 'vitest';
import { Sequelize } from 'sequelize';
import { SequelizeStateStore } from '../../src/SequelizeStateStore.js';
import type { ImportJobState, ProcessedRecord } from '@bulkimport/core';

function createJobState(overrides?: Partial<ImportJobState>): ImportJobState {
  return {
    id: 'job-001',
    config: {
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: false },
        ],
      },
      batchSize: 3,
      continueOnError: true,
    },
    status: 'PROCESSING',
    batches: [
      { id: 'b1', index: 0, status: 'PENDING', records: [], processedCount: 0, failedCount: 0 },
      { id: 'b2', index: 1, status: 'PENDING', records: [], processedCount: 0, failedCount: 0 },
      { id: 'b3', index: 2, status: 'PENDING', records: [], processedCount: 0, failedCount: 0 },
    ],
    totalRecords: 9,
    startedAt: 1700000000000,
    distributed: true,
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

describe('SequelizeStateStore — Distributed', () => {
  let sequelize: Sequelize;
  let store: SequelizeStateStore;

  beforeEach(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    store = new SequelizeStateStore(sequelize);
    await store.initialize();
  });

  /** Helper: save a distributed job + register batches in the batch table. */
  async function setupDistributedJob(): Promise<void> {
    const job = createJobState();
    await store.saveJobState(job);

    // Insert batch rows into the distributed batch table
    // We need to access the Batch model through the store's internal
    // For now, use saveBatchRecords to populate records, and manually insert batches
    // through the store's claimBatch mechanism.
    // Actually, we can use saveBatchRecords + insert batches via raw sequelize.
    // Better: use the internal Batch model via a helper.

    // Insert batch metadata via raw query since we don't expose batch creation method
    // In production, the PrepareDistributedImport use case would do this
    const batchTable = 'bulkimport_batches';
    await sequelize.query(
      `INSERT INTO ${batchTable} (id, "jobId", "batchIndex", status, "workerId", "claimedAt", "recordStartIndex", "recordEndIndex", "processedCount", "failedCount", version) VALUES
      ('b1', 'job-001', 0, 'PENDING', NULL, NULL, 0, 2, 0, 0, 0),
      ('b2', 'job-001', 1, 'PENDING', NULL, NULL, 3, 5, 0, 0, 0),
      ('b3', 'job-001', 2, 'PENDING', NULL, NULL, 6, 8, 0, 0, 0)`,
    );

    // Save records for each batch
    await store.saveBatchRecords('job-001', 'b1', [
      createRecord(0, 'pending'),
      createRecord(1, 'pending'),
      createRecord(2, 'pending'),
    ]);
    await store.saveBatchRecords('job-001', 'b2', [
      createRecord(3, 'pending'),
      createRecord(4, 'pending'),
      createRecord(5, 'pending'),
    ]);
    await store.saveBatchRecords('job-001', 'b3', [
      createRecord(6, 'pending'),
      createRecord(7, 'pending'),
      createRecord(8, 'pending'),
    ]);
  }

  describe('claimBatch', () => {
    it('should claim the first PENDING batch', async () => {
      await setupDistributedJob();

      const result = await store.claimBatch('job-001', 'worker-1');

      expect(result.claimed).toBe(true);
      if (result.claimed) {
        expect(result.reservation.batchId).toBe('b1');
        expect(result.reservation.batchIndex).toBe(0);
        expect(result.reservation.workerId).toBe('worker-1');
        expect(result.reservation.recordStartIndex).toBe(0);
        expect(result.reservation.recordEndIndex).toBe(2);
        expect(result.reservation.claimedAt).toBeGreaterThan(0);
      }
    });

    it('should return JOB_NOT_FOUND for non-existent job', async () => {
      const result = await store.claimBatch('non-existent', 'worker-1');
      expect(result.claimed).toBe(false);
      if (!result.claimed) {
        expect(result.reason).toBe('JOB_NOT_FOUND');
      }
    });

    it('should return JOB_NOT_PROCESSING for completed job', async () => {
      await store.saveJobState(createJobState({ status: 'COMPLETED' }));

      const result = await store.claimBatch('job-001', 'worker-1');
      expect(result.claimed).toBe(false);
      if (!result.claimed) {
        expect(result.reason).toBe('JOB_NOT_PROCESSING');
      }
    });

    it('should return NO_PENDING_BATCHES when all batches are claimed', async () => {
      await setupDistributedJob();

      // Claim all 3 batches
      await store.claimBatch('job-001', 'worker-1');
      await store.claimBatch('job-001', 'worker-2');
      await store.claimBatch('job-001', 'worker-3');

      const result = await store.claimBatch('job-001', 'worker-4');
      expect(result.claimed).toBe(false);
      if (!result.claimed) {
        expect(result.reason).toBe('NO_PENDING_BATCHES');
      }
    });

    it('should claim different batches for different workers', async () => {
      await setupDistributedJob();

      const r1 = await store.claimBatch('job-001', 'worker-1');
      const r2 = await store.claimBatch('job-001', 'worker-2');

      expect(r1.claimed).toBe(true);
      expect(r2.claimed).toBe(true);
      if (r1.claimed && r2.claimed) {
        expect(r1.reservation.batchId).not.toBe(r2.reservation.batchId);
        expect(r1.reservation.batchIndex).toBe(0);
        expect(r2.reservation.batchIndex).toBe(1);
      }
    });
  });

  describe('sequential claims (no double-claiming)', () => {
    it('should not allow two workers to claim the same batch', async () => {
      await setupDistributedJob();

      // Sequential claims (SQLite does not support concurrent transactions;
      // in production with PostgreSQL/MySQL, these would run concurrently)
      const r1 = await store.claimBatch('job-001', 'worker-A');
      const r2 = await store.claimBatch('job-001', 'worker-B');
      const r3 = await store.claimBatch('job-001', 'worker-C');
      const r4 = await store.claimBatch('job-001', 'worker-D');

      // All 3 should be claimed
      expect(r1.claimed).toBe(true);
      expect(r2.claimed).toBe(true);
      expect(r3.claimed).toBe(true);
      expect(r4.claimed).toBe(false);

      if (r1.claimed && r2.claimed && r3.claimed) {
        const batchIds = [r1.reservation.batchId, r2.reservation.batchId, r3.reservation.batchId];
        // No duplicates
        expect(new Set(batchIds).size).toBe(3);
      }
    });
  });

  describe('releaseBatch', () => {
    it('should release a claimed batch back to PENDING', async () => {
      await setupDistributedJob();

      const claim = await store.claimBatch('job-001', 'worker-1');
      expect(claim.claimed).toBe(true);

      if (claim.claimed) {
        await store.releaseBatch('job-001', claim.reservation.batchId, 'worker-1');

        // Should be claimable again
        const reClaim = await store.claimBatch('job-001', 'worker-2');
        expect(reClaim.claimed).toBe(true);
        if (reClaim.claimed) {
          expect(reClaim.reservation.batchId).toBe('b1');
          expect(reClaim.reservation.workerId).toBe('worker-2');
        }
      }
    });

    it('should not release a batch claimed by a different worker', async () => {
      await setupDistributedJob();

      await store.claimBatch('job-001', 'worker-1');

      // Try to release as worker-2 (should do nothing)
      await store.releaseBatch('job-001', 'b1', 'worker-2');

      // Batch b1 should still be PROCESSING (claimed by worker-1)
      // Next claim should get b2
      const claim = await store.claimBatch('job-001', 'worker-3');
      expect(claim.claimed).toBe(true);
      if (claim.claimed) {
        expect(claim.reservation.batchId).toBe('b2');
      }
    });
  });

  describe('reclaimStaleBatches', () => {
    it('should reclaim batches past the timeout', async () => {
      await setupDistributedJob();

      // Claim a batch
      await store.claimBatch('job-001', 'worker-1');

      // Manually set claimedAt to a very old timestamp
      await sequelize.query(`UPDATE bulkimport_batches SET "claimedAt" = 1000000000000 WHERE id = 'b1'`);

      // Reclaim with a short timeout
      const reclaimed = await store.reclaimStaleBatches('job-001', 60_000);
      expect(reclaimed).toBe(1);

      // Batch should be claimable again
      const claim = await store.claimBatch('job-001', 'worker-2');
      expect(claim.claimed).toBe(true);
      if (claim.claimed) {
        expect(claim.reservation.batchId).toBe('b1');
        expect(claim.reservation.workerId).toBe('worker-2');
      }
    });

    it('should not reclaim batches that are still within timeout', async () => {
      await setupDistributedJob();

      await store.claimBatch('job-001', 'worker-1');

      // Reclaim with a very long timeout — nothing should be reclaimed
      const reclaimed = await store.reclaimStaleBatches('job-001', 999_999_999);
      expect(reclaimed).toBe(0);
    });

    it('should return 0 when no batches are processing', async () => {
      await setupDistributedJob();

      const reclaimed = await store.reclaimStaleBatches('job-001', 60_000);
      expect(reclaimed).toBe(0);
    });
  });

  describe('saveBatchRecords + getBatchRecords', () => {
    it('should roundtrip batch records', async () => {
      await store.saveJobState(createJobState());

      const records = [createRecord(0, 'pending'), createRecord(1, 'pending'), createRecord(2, 'pending')];
      await store.saveBatchRecords('job-001', 'b1', records);

      const retrieved = await store.getBatchRecords('job-001', 'b1');
      expect(retrieved).toHaveLength(3);
      expect(retrieved[0]!.index).toBe(0);
      expect(retrieved[1]!.index).toBe(1);
      expect(retrieved[2]!.index).toBe(2);
      expect(retrieved[0]!.raw).toEqual({ email: 'user0@test.com', name: 'User 0' });
    });

    it('should return records ordered by index', async () => {
      await store.saveJobState(createJobState());

      const records = [createRecord(5, 'pending'), createRecord(3, 'pending'), createRecord(4, 'pending')];
      await store.saveBatchRecords('job-001', 'b2', records);

      const retrieved = await store.getBatchRecords('job-001', 'b2');
      expect(retrieved.map((r) => r.index)).toEqual([3, 4, 5]);
    });

    it('should not return records from other batches', async () => {
      await store.saveJobState(createJobState());

      await store.saveBatchRecords('job-001', 'b1', [createRecord(0, 'pending')]);
      await store.saveBatchRecords('job-001', 'b2', [createRecord(3, 'pending')]);

      const b1Records = await store.getBatchRecords('job-001', 'b1');
      expect(b1Records).toHaveLength(1);
      expect(b1Records[0]!.index).toBe(0);
    });
  });

  describe('getDistributedStatus', () => {
    it('should aggregate batch statuses correctly', async () => {
      await setupDistributedJob();

      // Claim and "complete" batch b1
      await store.claimBatch('job-001', 'worker-1');
      await store.updateBatchState('job-001', 'b1', {
        batchId: 'b1',
        status: 'COMPLETED',
        processedCount: 3,
        failedCount: 0,
      });

      const status = await store.getDistributedStatus('job-001');
      expect(status.totalBatches).toBe(3);
      expect(status.completedBatches).toBe(1);
      expect(status.processingBatches).toBe(0);
      expect(status.pendingBatches).toBe(2);
      expect(status.failedBatches).toBe(0);
      expect(status.isComplete).toBe(false);
    });

    it('should report isComplete when all batches are terminal', async () => {
      await setupDistributedJob();

      // Complete all batches
      for (const batchId of ['b1', 'b2', 'b3']) {
        await store.claimBatch('job-001', `worker-${batchId}`);
        await store.updateBatchState('job-001', batchId, {
          batchId,
          status: 'COMPLETED',
          processedCount: 3,
          failedCount: 0,
        });
      }

      const status = await store.getDistributedStatus('job-001');
      expect(status.isComplete).toBe(true);
      expect(status.completedBatches).toBe(3);
      expect(status.pendingBatches).toBe(0);
      expect(status.processingBatches).toBe(0);
    });

    it('should report isComplete with mixed COMPLETED and FAILED', async () => {
      await setupDistributedJob();

      // Complete b1 and b2, fail b3
      await store.claimBatch('job-001', 'w1');
      await store.updateBatchState('job-001', 'b1', {
        batchId: 'b1',
        status: 'COMPLETED',
        processedCount: 3,
        failedCount: 0,
      });
      await store.claimBatch('job-001', 'w2');
      await store.updateBatchState('job-001', 'b2', {
        batchId: 'b2',
        status: 'COMPLETED',
        processedCount: 3,
        failedCount: 0,
      });
      await store.claimBatch('job-001', 'w3');
      await store.updateBatchState('job-001', 'b3', {
        batchId: 'b3',
        status: 'FAILED',
        processedCount: 0,
        failedCount: 3,
      });

      const status = await store.getDistributedStatus('job-001');
      expect(status.isComplete).toBe(true);
      expect(status.completedBatches).toBe(2);
      expect(status.failedBatches).toBe(1);
    });

    it('should return all zeros for non-existent job', async () => {
      const status = await store.getDistributedStatus('non-existent');
      expect(status.totalBatches).toBe(0);
      expect(status.isComplete).toBe(false);
    });
  });

  describe('tryFinalizeJob', () => {
    it('should finalize job when all batches are complete', async () => {
      await setupDistributedJob();

      // Complete all batches
      for (const batchId of ['b1', 'b2', 'b3']) {
        await store.claimBatch('job-001', `worker-${batchId}`);
        await store.updateBatchState('job-001', batchId, {
          batchId,
          status: 'COMPLETED',
          processedCount: 3,
          failedCount: 0,
        });
      }

      const finalized = await store.tryFinalizeJob('job-001');
      expect(finalized).toBe(true);

      const job = await store.getJobState('job-001');
      expect(job!.status).toBe('COMPLETED');
      expect(job!.completedAt).toBeGreaterThan(0);
    });

    it('should set FAILED status when any batch failed', async () => {
      await setupDistributedJob();

      // Complete b1, b2; fail b3
      for (const batchId of ['b1', 'b2']) {
        await store.claimBatch('job-001', `w-${batchId}`);
        await store.updateBatchState('job-001', batchId, {
          batchId,
          status: 'COMPLETED',
          processedCount: 3,
          failedCount: 0,
        });
      }
      await store.claimBatch('job-001', 'w-b3');
      await store.updateBatchState('job-001', 'b3', {
        batchId: 'b3',
        status: 'FAILED',
        processedCount: 0,
        failedCount: 3,
      });

      const finalized = await store.tryFinalizeJob('job-001');
      expect(finalized).toBe(true);

      const job = await store.getJobState('job-001');
      expect(job!.status).toBe('FAILED');
    });

    it('should return false when batches are still pending', async () => {
      await setupDistributedJob();

      await store.claimBatch('job-001', 'worker-1');
      await store.updateBatchState('job-001', 'b1', {
        batchId: 'b1',
        status: 'COMPLETED',
        processedCount: 3,
        failedCount: 0,
      });

      const finalized = await store.tryFinalizeJob('job-001');
      expect(finalized).toBe(false);
    });

    it('should return false for non-existent job', async () => {
      const finalized = await store.tryFinalizeJob('non-existent');
      expect(finalized).toBe(false);
    });

    it('should guarantee exactly-once finalization', async () => {
      await setupDistributedJob();

      // Complete all batches
      for (const batchId of ['b1', 'b2', 'b3']) {
        await store.claimBatch('job-001', `worker-${batchId}`);
        await store.updateBatchState('job-001', batchId, {
          batchId,
          status: 'COMPLETED',
          processedCount: 3,
          failedCount: 0,
        });
      }

      // Sequential finalization attempts (SQLite doesn't support concurrent transactions;
      // in production with PostgreSQL/MySQL, these would run with Promise.all)
      const r1 = await store.tryFinalizeJob('job-001');
      const r2 = await store.tryFinalizeJob('job-001');
      const r3 = await store.tryFinalizeJob('job-001');

      const results = [r1, r2, r3];
      const trueCount = results.filter((r) => r).length;
      expect(trueCount).toBe(1);
    });
  });

  describe('distributed field on job state', () => {
    it('should persist and restore the distributed flag', async () => {
      const job = createJobState({ distributed: true });
      await store.saveJobState(job);

      const restored = await store.getJobState('job-001');
      expect(restored!.distributed).toBe(true);
    });

    it('should default to false when not set', async () => {
      const job = createJobState();
      delete (job as Record<string, unknown>)['distributed'];
      await store.saveJobState(job);

      const restored = await store.getJobState('job-001');
      // distributed is falsy when not set
      expect(restored!.distributed).toBeFalsy();
    });
  });

  describe('full distributed flow', () => {
    it('should support complete prepare → claim → process → finalize cycle', async () => {
      // Phase 1: Prepare
      await setupDistributedJob();

      // Phase 2: Workers claim and process
      const processedBatches: string[] = [];

      for (let i = 0; i < 3; i++) {
        const claim = await store.claimBatch('job-001', `worker-${String(i)}`);
        expect(claim.claimed).toBe(true);
        if (!claim.claimed) continue;

        const { batchId } = claim.reservation;
        processedBatches.push(batchId);

        // Load records
        const records = await store.getBatchRecords('job-001', batchId);
        expect(records).toHaveLength(3);

        // Process records (simulate)
        for (const record of records) {
          await store.saveProcessedRecord('job-001', batchId, {
            ...record,
            status: 'processed',
          });
        }

        // Mark batch completed
        await store.updateBatchState('job-001', batchId, {
          batchId,
          status: 'COMPLETED',
          processedCount: 3,
          failedCount: 0,
        });

        // Check if job should be finalized
        const finalized = await store.tryFinalizeJob('job-001');
        if (i < 2) {
          expect(finalized).toBe(false);
        } else {
          expect(finalized).toBe(true);
        }
      }

      // No more batches to claim
      const noBatch = await store.claimBatch('job-001', 'worker-late');
      expect(noBatch.claimed).toBe(false);

      // All 3 batches were processed
      expect(processedBatches).toEqual(['b1', 'b2', 'b3']);

      // Job is complete
      const job = await store.getJobState('job-001');
      expect(job!.status).toBe('COMPLETED');

      // All 9 records are processed
      const processed = await store.getProcessedRecords('job-001');
      expect(processed).toHaveLength(9);

      // Progress reflects completion
      const progress = await store.getProgress('job-001');
      expect(progress.processedRecords).toBe(9);
      expect(progress.failedRecords).toBe(0);
    });
  });
});
