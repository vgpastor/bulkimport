import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BatchEngine } from '../../src/BatchEngine.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import { InMemoryStateStore } from '../../src/infrastructure/state/InMemoryStateStore.js';
import { FileStateStore } from '../../src/infrastructure/state/FileStateStore.js';
import type { RawRecord } from '../../src/domain/model/Record.js';

const TEST_DIR = join(process.cwd(), `.batchactions-test-persistence-${String(process.pid)}`);

function simpleCsvParser() {
  return {
    *parse(data: string | Buffer): Iterable<RawRecord> {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      const lines = text.split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) return;
      const headers = lines[0]!.split(',').map((h) => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i]!.split(',').map((v) => v.trim());
        const record: RawRecord = {};
        for (let j = 0; j < headers.length; j++) {
          record[headers[j]!] = values[j] ?? '';
        }
        yield record;
      }
    },
  };
}

function generateCsv(count: number): string {
  const header = 'email,name,age';
  const rows: string[] = [];
  for (let i = 1; i <= count; i++) {
    rows.push(`user${String(i)}@test.com,User ${String(i)},${String(i * 10)}`);
  }
  return [header, ...rows].join('\n');
}

describe('State persistence and restore', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('StateStore integration during processing', () => {
    it('should persist records to StateStore during processing', async () => {
      const stateStore = new InMemoryStateStore();
      const csv = generateCsv(5);

      const engine = new BatchEngine({
        batchSize: 10,
        stateStore,
      });

      engine.from(new BufferSource(csv), simpleCsvParser());

      await engine.start(async () => {
        await Promise.resolve();
      });

      // Records should be persisted in the state store
      const processed = await stateStore.getProcessedRecords(engine.getJobId());
      expect(processed).toHaveLength(5);

      // Job state should be persisted
      const jobState = await stateStore.getJobState(engine.getJobId());
      expect(jobState).not.toBeNull();
      expect(jobState?.status).toBe('COMPLETED');
      expect(jobState?.totalRecords).toBe(5);
    });

    it('should persist failed records to StateStore', async () => {
      const stateStore = new InMemoryStateStore();
      const csv = [
        'email,name,age',
        'valid@test.com,Valid,30',
        'not-email,Invalid,25',
        'also@test.com,Also Valid,20',
      ].join('\n');

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const engine = new BatchEngine({
        batchSize: 10,
        continueOnError: true,
        stateStore,
        validate: (record) => {
          const email = (record.email as string | undefined) ?? '';
          if (!emailRegex.test(email)) {
            return {
              isValid: false,
              errors: [{ field: 'email', message: 'Invalid email', code: 'TYPE_MISMATCH' as const }],
            };
          }
          return { isValid: true, errors: [] };
        },
      });

      engine.from(new BufferSource(csv), simpleCsvParser());
      await engine.start(async () => {
        await Promise.resolve();
      });

      const failed = await stateStore.getFailedRecords(engine.getJobId());
      expect(failed).toHaveLength(1);
      expect(failed[0]?.status).toBe('invalid');
    });

    it('should persist state after each batch for crash recovery', async () => {
      const stateStore = new InMemoryStateStore();
      const csv = generateCsv(15);
      let batchesSaved = 0;

      // Spy on saveJobState by wrapping the store
      const originalSave = stateStore.saveJobState.bind(stateStore);
      stateStore.saveJobState = async (job) => {
        batchesSaved++;
        return originalSave(job);
      };

      const engine = new BatchEngine({
        batchSize: 5,
        stateStore,
      });

      engine.from(new BufferSource(csv), simpleCsvParser());
      await engine.start(async () => {
        await Promise.resolve();
      });

      // saveJobState called: once per batch (3) + once at end of start()
      expect(batchesSaved).toBeGreaterThanOrEqual(3);
    });
  });

  describe('BatchEngine.restore()', () => {
    it('should restore a job from persisted state', async () => {
      const stateStore = new InMemoryStateStore();

      // Run a job that completes successfully
      const csv = generateCsv(10);
      const engine = new BatchEngine({
        batchSize: 5,
        stateStore,
      });

      engine.from(new BufferSource(csv), simpleCsvParser());
      await engine.start(async () => {
        await Promise.resolve();
      });

      const jobId = engine.getJobId();

      // Restore from state
      const restored = await BatchEngine.restore(jobId, { stateStore });
      expect(restored).not.toBeNull();
    });

    it('should return null for non-existent job', async () => {
      const stateStore = new InMemoryStateStore();

      const restored = await BatchEngine.restore('non-existent', { stateStore });
      expect(restored).toBeNull();
    });

    it('should skip already-completed batches when re-processing', async () => {
      const stateStore = new InMemoryStateStore();

      // Simulate a partially completed job by saving state directly
      const jobId = 'test-restore-job';
      await stateStore.saveJobState({
        id: jobId,
        config: { batchSize: 5 },
        status: 'FAILED',
        batches: [
          { id: 'b-0', index: 0, status: 'COMPLETED', records: [], processedCount: 5, failedCount: 0 },
          { id: 'b-1', index: 1, status: 'COMPLETED', records: [], processedCount: 5, failedCount: 0 },
        ],
        totalRecords: 15,
        startedAt: Date.now() - 1000,
      });

      // Restore and continue with the same 15-record dataset
      const csv = generateCsv(15);
      const restored = await BatchEngine.restore(jobId, { batchSize: 5, stateStore });
      expect(restored).not.toBeNull();

      restored!.from(new BufferSource(csv), simpleCsvParser());

      const processedInRestore: RawRecord[] = [];
      await restored!.start(async (record) => {
        processedInRestore.push(record);
        await Promise.resolve();
      });

      // Batches 0 and 1 (10 records) were already completed — only batch 2 (5 records) should be processed
      expect(processedInRestore).toHaveLength(5);

      const status = restored!.getStatus();
      expect(status.status).toBe('COMPLETED');
      // Total processed = 10 (restored) + 5 (new) = 15
      expect(status.progress.processedRecords).toBe(15);
    });
  });

  describe('FileStateStore integration', () => {
    it('should persist and restore with FileStateStore', async () => {
      const stateStore = new FileStateStore({ directory: TEST_DIR });

      const csv = generateCsv(5);
      const engine = new BatchEngine({
        batchSize: 10,
        stateStore,
        continueOnError: true,
      });

      engine.from(new BufferSource(csv), simpleCsvParser());
      await engine.start(async () => {
        await Promise.resolve();
      });

      const jobId = engine.getJobId();

      // Verify state was written to disk
      const jobState = await stateStore.getJobState(jobId);
      expect(jobState).not.toBeNull();
      expect(jobState?.status).toBe('COMPLETED');
      expect(jobState?.totalRecords).toBe(5);

      // Verify records were persisted
      const processed = await stateStore.getProcessedRecords(jobId);
      expect(processed).toHaveLength(5);
    });
  });
});
