import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import { InMemoryStateStore } from '../../src/infrastructure/state/InMemoryStateStore.js';
import { FileStateStore } from '../../src/infrastructure/state/FileStateStore.js';
import type { RawRecord } from '../../src/domain/model/Record.js';

const TEST_DIR = join(process.cwd(), `.bulkimport-test-persistence-${String(process.pid)}`);

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

      const importer = new BulkImport({
        schema: {
          fields: [
            { name: 'email', type: 'email', required: true },
            { name: 'name', type: 'string', required: true },
            { name: 'age', type: 'number', required: false },
          ],
        },
        batchSize: 10,
        stateStore,
      });

      importer.from(new BufferSource(csv), new CsvParser());

      await importer.start(async () => {
        await Promise.resolve();
      });

      // Records should be persisted in the state store
      const processed = await stateStore.getProcessedRecords(importer.getJobId());
      expect(processed).toHaveLength(5);

      // Job state should be persisted
      const jobState = await stateStore.getJobState(importer.getJobId());
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

      const importer = new BulkImport({
        schema: {
          fields: [
            { name: 'email', type: 'email', required: true },
            { name: 'name', type: 'string', required: true },
            { name: 'age', type: 'number', required: false },
          ],
        },
        batchSize: 10,
        continueOnError: true,
        stateStore,
      });

      importer.from(new BufferSource(csv), new CsvParser());
      await importer.start(async () => {
        await Promise.resolve();
      });

      const failed = await stateStore.getFailedRecords(importer.getJobId());
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

      const importer = new BulkImport({
        schema: {
          fields: [
            { name: 'email', type: 'email', required: true },
            { name: 'name', type: 'string', required: true },
            { name: 'age', type: 'number', required: false },
          ],
        },
        batchSize: 5,
        stateStore,
      });

      importer.from(new BufferSource(csv), new CsvParser());
      await importer.start(async () => {
        await Promise.resolve();
      });

      // saveJobState called: once per batch (3) + once at end of start()
      expect(batchesSaved).toBeGreaterThanOrEqual(3);
    });
  });

  describe('BulkImport.restore()', () => {
    it('should restore a job from persisted state', async () => {
      const stateStore = new InMemoryStateStore();
      const schema = {
        fields: [
          { name: 'email', type: 'email' as const, required: true },
          { name: 'name', type: 'string' as const, required: true },
          { name: 'age', type: 'number' as const, required: false },
        ],
      };

      // Run an import that completes successfully
      const csv = generateCsv(10);
      const importer = new BulkImport({
        schema,
        batchSize: 5,
        stateStore,
      });

      importer.from(new BufferSource(csv), new CsvParser());
      await importer.start(async () => {
        await Promise.resolve();
      });

      const jobId = importer.getJobId();

      // Restore from state
      const restored = await BulkImport.restore(jobId, { schema, stateStore });
      expect(restored).not.toBeNull();
    });

    it('should return null for non-existent job', async () => {
      const stateStore = new InMemoryStateStore();
      const schema = {
        fields: [{ name: 'email', type: 'email' as const, required: true }],
      };

      const restored = await BulkImport.restore('non-existent', { schema, stateStore });
      expect(restored).toBeNull();
    });

    it('should skip already-completed batches when re-processing', async () => {
      const stateStore = new InMemoryStateStore();
      const schema = {
        fields: [
          { name: 'email', type: 'email' as const, required: true },
          { name: 'name', type: 'string' as const, required: true },
        ],
      };

      // Simulate a partially completed import by saving state directly
      const jobId = 'test-restore-job';
      await stateStore.saveJobState({
        id: jobId,
        config: { schema, batchSize: 5 },
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
      const restored = await BulkImport.restore(jobId, { schema, batchSize: 5, stateStore });
      expect(restored).not.toBeNull();

      restored!.from(new BufferSource(csv), new CsvParser());

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
      const schema = {
        fields: [
          { name: 'email', type: 'email' as const, required: true },
          { name: 'name', type: 'string' as const, required: true },
        ],
      };

      const csv = generateCsv(5);
      const importer = new BulkImport({
        schema,
        batchSize: 10,
        stateStore,
        continueOnError: true,
      });

      importer.from(new BufferSource(csv), new CsvParser());
      await importer.start(async () => {
        await Promise.resolve();
      });

      const jobId = importer.getJobId();

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
