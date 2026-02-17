import { describe, it, expect, beforeEach } from 'vitest';
import type {
  DistributedStateStore,
  ClaimBatchResult,
  DistributedJobStatus,
  ProcessedRecord,
  ImportJobState,
  ImportProgress,
  BatchState,
  RawRecord,
} from '@bulkimport/core';
import { BufferSource, CsvParser } from '@bulkimport/core';
import { DistributedImport } from '../src/DistributedImport.js';
import type { DistributedImportConfig } from '../src/DistributedImport.js';

// --- Mock DistributedStateStore ---

class MockDistributedStateStore implements DistributedStateStore {
  jobs = new Map<string, ImportJobState>();
  records = new Map<string, Map<string, ProcessedRecord[]>>(); // jobId → batchId → records
  batchClaims = new Map<string, { status: string; workerId?: string; claimedAt?: number }[]>(); // jobId → batch states
  finalized = new Set<string>();

  async saveJobState(job: ImportJobState): Promise<void> {
    this.jobs.set(job.id, job);
    if (!this.batchClaims.has(job.id)) {
      this.batchClaims.set(
        job.id,
        job.batches.map((b) => ({
          status: b.status,
          workerId: b.workerId,
          claimedAt: b.claimedAt,
        })),
      );
    }
  }

  async getJobState(jobId: string): Promise<ImportJobState | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async updateBatchState(jobId: string, batchId: string, state: BatchState): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const batches = job.batches.map((b) =>
      b.id === batchId
        ? { ...b, status: state.status, processedCount: state.processedCount, failedCount: state.failedCount }
        : b,
    );
    this.jobs.set(jobId, { ...job, batches });

    // Also update the claims tracking
    const claims = this.batchClaims.get(jobId);
    if (claims) {
      const batchIndex = job.batches.findIndex((b) => b.id === batchId);
      if (batchIndex >= 0 && claims[batchIndex]) {
        claims[batchIndex]!.status = state.status;
      }
    }
  }

  async saveProcessedRecord(jobId: string, batchId: string, record: ProcessedRecord): Promise<void> {
    if (!this.records.has(jobId)) this.records.set(jobId, new Map());
    const jobRecords = this.records.get(jobId)!;
    if (!jobRecords.has(batchId)) jobRecords.set(batchId, []);
    const batchRecords = jobRecords.get(batchId)!;
    const existingIdx = batchRecords.findIndex((r) => r.index === record.index);
    if (existingIdx >= 0) {
      batchRecords[existingIdx] = record;
    } else {
      batchRecords.push(record);
    }
  }

  async getFailedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const jobRecords = this.records.get(jobId);
    if (!jobRecords) return [];
    const all: ProcessedRecord[] = [];
    for (const batchRecords of jobRecords.values()) {
      all.push(...batchRecords.filter((r) => r.status === 'failed' || r.status === 'invalid'));
    }
    return all;
  }

  async getPendingRecords(_jobId: string): Promise<readonly ProcessedRecord[]> {
    return [];
  }

  async getProcessedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const jobRecords = this.records.get(jobId);
    if (!jobRecords) return [];
    const all: ProcessedRecord[] = [];
    for (const batchRecords of jobRecords.values()) {
      all.push(...batchRecords.filter((r) => r.status === 'processed'));
    }
    return all;
  }

  async getProgress(_jobId: string): Promise<ImportProgress> {
    return {
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      pendingRecords: 0,
      percentage: 0,
      currentBatch: 0,
      totalBatches: 0,
      elapsedMs: 0,
    };
  }

  // --- DistributedStateStore methods ---

  async claimBatch(jobId: string, workerId: string): Promise<ClaimBatchResult> {
    const job = this.jobs.get(jobId);
    if (!job) return { claimed: false, reason: 'JOB_NOT_FOUND' };
    if (job.status !== 'PROCESSING') return { claimed: false, reason: 'JOB_NOT_PROCESSING' };

    const claims = this.batchClaims.get(jobId) ?? [];
    const pendingIdx = claims.findIndex((c) => c.status === 'PENDING');
    if (pendingIdx < 0) return { claimed: false, reason: 'NO_PENDING_BATCHES' };

    const batch = job.batches[pendingIdx];
    if (!batch) return { claimed: false, reason: 'NO_PENDING_BATCHES' };

    claims[pendingIdx] = { status: 'PROCESSING', workerId, claimedAt: Date.now() };

    const updatedBatches = job.batches.map((b, i) =>
      i === pendingIdx ? { ...b, status: 'PROCESSING' as const, workerId, claimedAt: Date.now() } : b,
    );
    this.jobs.set(jobId, { ...job, batches: updatedBatches });

    const reservation: BatchReservation = {
      jobId,
      batchId: batch.id,
      batchIndex: batch.index,
      workerId,
      claimedAt: Date.now(),
      recordStartIndex: batch.recordStartIndex ?? 0,
      recordEndIndex: batch.recordEndIndex ?? 0,
    };

    return { claimed: true, reservation };
  }

  async releaseBatch(jobId: string, batchId: string, workerId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const claims = this.batchClaims.get(jobId) ?? [];
    const idx = job.batches.findIndex((b) => b.id === batchId);
    if (idx < 0) return;
    const claim = claims[idx];
    if (claim && claim.workerId === workerId) {
      claim.status = 'PENDING';
      claim.workerId = undefined;
      claim.claimedAt = undefined;
      const updatedBatches = job.batches.map((b, i) =>
        i === idx ? { ...b, status: 'PENDING' as const, workerId: undefined, claimedAt: undefined } : b,
      );
      this.jobs.set(jobId, { ...job, batches: updatedBatches });
    }
  }

  async reclaimStaleBatches(jobId: string, timeoutMs: number): Promise<number> {
    const claims = this.batchClaims.get(jobId) ?? [];
    const job = this.jobs.get(jobId);
    if (!job) return 0;
    let reclaimed = 0;
    const now = Date.now();
    const updatedBatches = [...job.batches];
    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i];
      if (claim && claim.status === 'PROCESSING' && claim.claimedAt && now - claim.claimedAt > timeoutMs) {
        claim.status = 'PENDING';
        claim.workerId = undefined;
        claim.claimedAt = undefined;
        if (updatedBatches[i]) {
          updatedBatches[i] = {
            ...updatedBatches[i]!,
            status: 'PENDING' as const,
            workerId: undefined,
            claimedAt: undefined,
          };
        }
        reclaimed++;
      }
    }
    if (reclaimed > 0) {
      this.jobs.set(jobId, { ...job, batches: updatedBatches });
    }
    return reclaimed;
  }

  async saveBatchRecords(jobId: string, batchId: string, records: readonly ProcessedRecord[]): Promise<void> {
    if (!this.records.has(jobId)) this.records.set(jobId, new Map());
    const jobRecords = this.records.get(jobId)!;
    jobRecords.set(batchId, [...records]);
  }

  async getBatchRecords(jobId: string, batchId: string): Promise<readonly ProcessedRecord[]> {
    const jobRecords = this.records.get(jobId);
    if (!jobRecords) return [];
    return jobRecords.get(batchId) ?? [];
  }

  async getDistributedStatus(jobId: string): Promise<DistributedJobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return {
        jobId,
        totalBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        processingBatches: 0,
        pendingBatches: 0,
        isComplete: false,
      };
    }
    const claims = this.batchClaims.get(jobId) ?? [];
    const completed = claims.filter((c) => c.status === 'COMPLETED').length;
    const failed = claims.filter((c) => c.status === 'FAILED').length;
    const processing = claims.filter((c) => c.status === 'PROCESSING').length;
    const pending = claims.filter((c) => c.status === 'PENDING').length;
    return {
      jobId,
      totalBatches: claims.length,
      completedBatches: completed,
      failedBatches: failed,
      processingBatches: processing,
      pendingBatches: pending,
      isComplete: completed + failed === claims.length && claims.length > 0,
    };
  }

  async tryFinalizeJob(jobId: string): Promise<boolean> {
    if (this.finalized.has(jobId)) return false;
    const status = await this.getDistributedStatus(jobId);
    if (status.isComplete) {
      this.finalized.add(jobId);
      const job = this.jobs.get(jobId);
      if (job) {
        this.jobs.set(jobId, { ...job, status: 'COMPLETED' });
      }
      return true;
    }
    return false;
  }
}

// --- Helpers ---

function generateCsv(count: number, fields: string[] = ['name', 'email']): string {
  const header = fields.join(',');
  const rows = Array.from({ length: count }, (_, i) =>
    fields.map((f) => (f === 'email' ? `user${String(i)}@test.com` : `value${String(i)}`)).join(','),
  );
  return [header, ...rows].join('\n');
}

function createConfig(stateStore: MockDistributedStateStore): DistributedImportConfig {
  return {
    schema: {
      fields: [
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'email', required: true },
      ],
    },
    batchSize: 5,
    continueOnError: true,
    stateStore,
  };
}

// --- Tests ---

describe('Distributed Processing', () => {
  let stateStore: MockDistributedStateStore;

  beforeEach(() => {
    stateStore = new MockDistributedStateStore();
  });

  describe('prepare()', () => {
    it('should create batch records in the StateStore', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      const csv = generateCsv(12);
      const result = await di.prepare(new BufferSource(csv), new CsvParser());

      expect(result.totalRecords).toBe(12);
      expect(result.totalBatches).toBe(3); // 12 records / batchSize 5 = 3 batches (5+5+2)
      expect(result.jobId).toBeDefined();

      // Verify records were materialized
      const job = await stateStore.getJobState(result.jobId);
      expect(job).not.toBeNull();
      expect(job!.distributed).toBe(true);
      expect(job!.status).toBe('PROCESSING');
      expect(job!.batches).toHaveLength(3);

      // Verify records exist for each batch
      for (const batch of job!.batches) {
        const records = await stateStore.getBatchRecords(result.jobId, batch.id);
        expect(records.length).toBeGreaterThan(0);
      }
    });

    it('should emit distributed:prepared event', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      const events: unknown[] = [];
      di.on('distributed:prepared', (e) => events.push(e));

      const csv = generateCsv(10);
      await di.prepare(new BufferSource(csv), new CsvParser());

      expect(events).toHaveLength(1);
    });
  });

  describe('processWorkerBatch()', () => {
    it('should allow a single worker to process all batches sequentially', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      const csv = generateCsv(10);
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const processed: string[] = [];
      const processor = async (record: RawRecord) => {
        processed.push(String(record['name']));
      };

      let result = await di.processWorkerBatch(jobId, processor, 'worker-1');
      expect(result.claimed).toBe(true);

      result = await di.processWorkerBatch(jobId, processor, 'worker-1');
      expect(result.claimed).toBe(true);
      expect(result.jobComplete).toBe(true);

      expect(processed).toHaveLength(10);
    });

    it('should return claimed=false when no pending batches remain', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      const csv = generateCsv(3); // 3 records = 1 batch
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const processor = async () => {};

      const r1 = await di.processWorkerBatch(jobId, processor, 'worker-1');
      expect(r1.claimed).toBe(true);
      expect(r1.jobComplete).toBe(true);

      const r2 = await di.processWorkerBatch(jobId, processor, 'worker-2');
      expect(r2.claimed).toBe(false);
    });

    it('should allow multiple workers to process batches in parallel without overlap', async () => {
      const config = createConfig(stateStore);
      const di = new DistributedImport(config);
      const csv = generateCsv(20); // 4 batches of 5
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const workerRecords = new Map<string, string[]>();
      const makeProcessor = (workerId: string) => async (record: RawRecord) => {
        if (!workerRecords.has(workerId)) workerRecords.set(workerId, []);
        workerRecords.get(workerId)!.push(String(record['name']));
      };

      // Simulate 4 concurrent workers
      const workers = ['w1', 'w2', 'w3', 'w4'].map(async (wId) => {
        const results: boolean[] = [];
        while (true) {
          const r = await di.processWorkerBatch(jobId, makeProcessor(wId), wId);
          results.push(r.claimed);
          if (!r.claimed || r.jobComplete) break;
        }
        return results;
      });

      await Promise.all(workers);

      // All 20 records should be processed exactly once
      const allProcessed = [...workerRecords.values()].flat();
      expect(allProcessed).toHaveLength(20);
      const uniqueRecords = new Set(allProcessed);
      expect(uniqueRecords.size).toBe(20);
    });

    it('should detect job completion and finalize exactly once', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      const csv = generateCsv(5); // 1 batch
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const completionEvents: unknown[] = [];
      di.on('import:completed', (e) => completionEvents.push(e));

      const r = await di.processWorkerBatch(jobId, async () => {}, 'w1');
      expect(r.jobComplete).toBe(true);

      // Second call — job already finalized
      const r2 = await di.processWorkerBatch(jobId, async () => {}, 'w2');
      expect(r2.claimed).toBe(false);

      expect(completionEvents).toHaveLength(1);
    });

    it('should emit batch:claimed event when claiming', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      const csv = generateCsv(5);
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const events: unknown[] = [];
      di.on('batch:claimed', (e) => events.push(e));

      await di.processWorkerBatch(jobId, async () => {}, 'worker-99');

      expect(events).toHaveLength(1);
      expect(events[0]).toHaveProperty('workerId', 'worker-99');
    });

    it('should work with continueOnError', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      const csv = generateCsv(5);
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      let callCount = 0;
      const processor = async () => {
        callCount++;
        if (callCount === 2) throw new Error('Process error');
      };

      const r = await di.processWorkerBatch(jobId, processor, 'w1');
      expect(r.claimed).toBe(true);
      expect(r.processedCount).toBe(4);
      expect(r.failedCount).toBe(1);
    });

    it('should validate records against schema', async () => {
      const di = new DistributedImport(createConfig(stateStore));
      // Invalid: missing email
      const csv = 'name,email\nAlice,alice@test.com\nBob,not-an-email';
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const processed: string[] = [];
      const r = await di.processWorkerBatch(
        jobId,
        async (record) => {
          processed.push(String(record['name']));
        },
        'w1',
      );

      expect(r.processedCount).toBe(1);
      expect(r.failedCount).toBe(1);
      expect(processed).toEqual(['Alice']);
    });

    it('should support hooks in distributed mode', async () => {
      const config: DistributedImportConfig = {
        ...createConfig(stateStore),
        hooks: {
          beforeValidate: async (record) => ({
            ...record,
            name: `PREFIX_${String(record['name'])}`,
          }),
        },
      };
      const di = new DistributedImport(config);
      const csv = generateCsv(3);
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const names: string[] = [];
      await di.processWorkerBatch(
        jobId,
        async (record) => {
          names.push(String(record['name']));
        },
        'w1',
      );

      expect(names.every((n) => n.startsWith('PREFIX_'))).toBe(true);
    });

    it('should support DuplicateChecker in distributed mode', async () => {
      const config: DistributedImportConfig = {
        ...createConfig(stateStore),
        duplicateChecker: {
          check: async (record) => ({
            isDuplicate: String(record['name']) === 'value0',
            existingId: 'existing-1',
          }),
        },
      };
      const di = new DistributedImport(config);
      const csv = generateCsv(3);
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      const r = await di.processWorkerBatch(jobId, async () => {}, 'w1');
      expect(r.processedCount).toBe(2);
      expect(r.failedCount).toBe(1);
    });

    it('should handle worker crash recovery via reclaimStaleBatches', async () => {
      const config: DistributedImportConfig = {
        ...createConfig(stateStore),
        staleBatchTimeoutMs: 0, // Immediate reclaim for testing
      };
      const di = new DistributedImport(config);
      const csv = generateCsv(10); // 2 batches
      const { jobId } = await di.prepare(new BufferSource(csv), new CsvParser());

      // Simulate worker crash: claim batch but don't complete it
      const job = await stateStore.getJobState(jobId);
      const claims = stateStore.batchClaims.get(jobId)!;
      claims[0] = { status: 'PROCESSING', workerId: 'crashed-worker', claimedAt: Date.now() - 1000 };
      const updatedBatches = job!.batches.map((b, i) =>
        i === 0 ? { ...b, status: 'PROCESSING' as const, workerId: 'crashed-worker', claimedAt: Date.now() - 1000 } : b,
      );
      stateStore.jobs.set(jobId, { ...job!, batches: updatedBatches });

      // New worker should reclaim the stale batch
      const processed: string[] = [];
      const processor = async (record: RawRecord) => {
        processed.push(String(record['name']));
      };

      // Process all batches (reclaim + pending)
      let r = await di.processWorkerBatch(jobId, processor, 'recovery-worker');
      expect(r.claimed).toBe(true);
      r = await di.processWorkerBatch(jobId, processor, 'recovery-worker');
      expect(r.claimed).toBe(true);
      expect(r.jobComplete).toBe(true);

      expect(processed).toHaveLength(10);
    });
  });

  describe('error cases', () => {
    it('should throw when using InMemoryStateStore', () => {
      const { InMemoryStateStore } = require('@bulkimport/core');
      expect(() => {
        new DistributedImport({
          schema: { fields: [{ name: 'name', type: 'string' }] },
          stateStore: new InMemoryStateStore(),
        });
      }).toThrow(/DistributedStateStore/);
    });
  });
});
