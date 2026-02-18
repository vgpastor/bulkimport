import { describe, it, expect } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource, InMemoryStateStore } from '@batchactions/core';
import type { SchemaDefinition } from '../../src/domain/model/Schema.js';

const schema: SchemaDefinition = {
  fields: [
    { name: 'email', type: 'email', required: true },
    { name: 'name', type: 'string', required: true },
  ],
};

function createImporter(overrides?: { continueOnError?: boolean; batchSize?: number; maxConcurrentBatches?: number }) {
  return new BulkImport({
    schema,
    batchSize: overrides?.batchSize ?? 100,
    continueOnError: overrides?.continueOnError ?? false,
    maxConcurrentBatches: overrides?.maxConcurrentBatches ?? 1,
  });
}

const noop = async (_record: unknown) => {
  await Promise.resolve();
};

describe('BulkImport — uncovered branches', () => {
  // --- assertSourceConfigured ---

  describe('assertSourceConfigured', () => {
    it('should throw when calling start() without source configured', async () => {
      const importer = createImporter();
      await expect(importer.start(noop)).rejects.toThrow(
        'Source and parser must be configured. Call .from(source, parser) first.',
      );
    });

    it('should throw when calling preview() without source configured', async () => {
      const importer = createImporter();
      await expect(importer.preview()).rejects.toThrow(
        'Source and parser must be configured. Call .from(source, parser) first.',
      );
    });
  });

  // --- assertCanStart ---

  describe('assertCanStart', () => {
    it('should throw when calling start() after import already completed', async () => {
      const csv = 'email,name\nuser@test.com,Alice';
      const importer = createImporter();
      importer.from(new BufferSource(csv), new CsvParser());
      await importer.start(noop);

      expect(importer.getStatus().status).toBe('COMPLETED');

      // Second start should fail
      importer.from(new BufferSource(csv), new CsvParser());
      await expect(importer.start(noop)).rejects.toThrow("Cannot start job from status 'COMPLETED'");
    });
  });

  // --- pause/resume/abort error paths ---

  describe('pause from wrong state', () => {
    it('should throw when pausing a non-PROCESSING import', async () => {
      const importer = createImporter();
      await expect(importer.pause()).rejects.toThrow("Cannot pause job from status 'CREATED'");
    });
  });

  describe('resume from wrong state', () => {
    it('should throw when resuming from CREATED', () => {
      const importer = createImporter();
      expect(() => {
        importer.resume();
      }).toThrow("Cannot resume job from status 'CREATED'");
    });

    it('should throw when resuming an aborted import', async () => {
      const csv = 'email,name\nuser@test.com,Alice\nuser2@test.com,Bob';
      const importer = createImporter({ batchSize: 1 });
      importer.from(new BufferSource(csv), new CsvParser());

      let recordCount = 0;
      const startPromise = importer.start(async () => {
        recordCount++;
        if (recordCount === 1) {
          await importer.pause();
          await importer.abort();
        }
      });

      await startPromise;

      expect(importer.getStatus().status).toBe('ABORTED');
      expect(() => {
        importer.resume();
      }).toThrow('Cannot resume an aborted job');
    });
  });

  describe('abort from wrong state', () => {
    it('should throw when aborting a CREATED import', async () => {
      const importer = createImporter();
      await expect(importer.abort()).rejects.toThrow("Cannot abort job from status 'CREATED'");
    });

    it('should throw when aborting an already completed import', async () => {
      const csv = 'email,name\nuser@test.com,Alice';
      const importer = createImporter();
      importer.from(new BufferSource(csv), new CsvParser());
      await importer.start(noop);

      await expect(importer.abort()).rejects.toThrow("Cannot abort job from status 'COMPLETED'");
    });
  });

  // --- Processor error with continueOnError: false ---

  describe('processor error propagation', () => {
    it('should transition to FAILED when processor throws and continueOnError is false', async () => {
      const csv = 'email,name\nuser@test.com,Alice';
      const importer = createImporter({ continueOnError: false });
      importer.from(new BufferSource(csv), new CsvParser());

      const events: string[] = [];
      importer.on('job:failed', () => {
        events.push('job:failed');
      });

      await importer.start(async () => {
        await Promise.resolve();
        throw new Error('DB connection failed');
      });

      expect(importer.getStatus().status).toBe('FAILED');
      expect(events).toContain('job:failed');
    });

    it('should emit job:failed with the error message', async () => {
      const csv = 'email,name\nuser@test.com,Alice';
      const importer = createImporter({ continueOnError: false });
      importer.from(new BufferSource(csv), new CsvParser());

      let failedError = '';
      importer.on('job:failed', (event) => {
        failedError = event.error;
      });

      await importer.start(async () => {
        await Promise.resolve();
        throw new Error('DB connection failed');
      });

      expect(failedError).toBe('DB connection failed');
    });

    it('should handle non-Error throw in processor', async () => {
      const csv = 'email,name\nuser@test.com,Alice';
      const importer = createImporter({ continueOnError: false });
      importer.from(new BufferSource(csv), new CsvParser());

      await importer.start(async () => {
        await Promise.resolve();
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string error';
      });

      expect(importer.getStatus().status).toBe('FAILED');
    });
  });

  // --- Abort during processing ---

  describe('abort during processing', () => {
    it('should abort mid-batch and not emit job:completed', async () => {
      const csv = 'email,name\na@test.com,A\nb@test.com,B\nc@test.com,C\nd@test.com,D';
      const importer = createImporter({ batchSize: 1 });
      importer.from(new BufferSource(csv), new CsvParser());

      const events: string[] = [];
      importer.on('job:completed', () => {
        events.push('completed');
      });
      importer.on('job:aborted', () => {
        events.push('aborted');
      });

      let count = 0;
      await importer.start(async () => {
        count++;
        if (count === 2) {
          await importer.abort();
        }
      });

      expect(importer.getStatus().status).toBe('ABORTED');
      expect(events).toContain('aborted');
      expect(events).not.toContain('completed');
    });

    it('should abort from paused state', async () => {
      const csv = 'email,name\na@test.com,A\nb@test.com,B';
      const importer = createImporter({ batchSize: 1 });
      importer.from(new BufferSource(csv), new CsvParser());

      let count = 0;
      await importer.start(async () => {
        count++;
        if (count === 1) {
          await importer.pause();
          // Abort while paused — should resolve the pause promise and signal abort
          await importer.abort();
        }
      });

      expect(importer.getStatus().status).toBe('ABORTED');
    });
  });

  // --- Validation failure with continueOnError: false ---

  describe('validation failure stops processing', () => {
    it('should transition to FAILED when validation fails and continueOnError is false', async () => {
      const csv = 'email,name\nnot-an-email,Alice';
      const importer = createImporter({ continueOnError: false });
      importer.from(new BufferSource(csv), new CsvParser());

      let failedError = '';
      importer.on('job:failed', (event) => {
        failedError = event.error;
      });

      await importer.start(noop);

      expect(importer.getStatus().status).toBe('FAILED');
      expect(failedError).toContain('Validation failed for record 0');
    });
  });

  // --- generateTemplate ---

  describe('generateTemplate', () => {
    it('should generate CSV header from schema', () => {
      const template = BulkImport.generateTemplate(schema);
      expect(template).toBe('email,name');
    });
  });

  // --- getJobId ---

  describe('getJobId', () => {
    it('should return a valid UUID', () => {
      const importer = createImporter();
      expect(importer.getJobId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  // --- getPendingRecords ---

  describe('getPendingRecords', () => {
    it('should always return empty array in streaming mode', () => {
      const importer = createImporter();
      expect(importer.getPendingRecords()).toEqual([]);
    });
  });

  // --- restore ---

  describe('restore', () => {
    it('should return null for non-existent job', async () => {
      const result = await BulkImport.restore('non-existent', { schema });
      expect(result).toBeNull();
    });

    it('should restore and resume from persisted state', async () => {
      const stateStore = new InMemoryStateStore();
      const csv = 'email,name\na@test.com,A\nb@test.com,B\nc@test.com,C\nd@test.com,D';
      const importer = new BulkImport({ schema, batchSize: 2, stateStore });
      importer.from(new BufferSource(csv), new CsvParser());

      const processed: string[] = [];
      await importer.start(async (record) => {
        processed.push(record.email as string);
        await Promise.resolve();
      });

      expect(processed).toHaveLength(4);

      const jobId = importer.getJobId();
      const restored = await BulkImport.restore(jobId, { schema, batchSize: 2, stateStore });
      expect(restored).not.toBeNull();
      expect(restored!.getJobId()).toBe(jobId);
    });
  });

  // --- State store integration on abort ---

  describe('state persistence on abort', () => {
    it('should save state after abort', async () => {
      const stateStore = new InMemoryStateStore();
      const csv = 'email,name\na@test.com,A\nb@test.com,B\nc@test.com,C';
      const importer = new BulkImport({ schema, batchSize: 1, stateStore });
      importer.from(new BufferSource(csv), new CsvParser());

      let count = 0;
      await importer.start(async () => {
        count++;
        if (count === 1) {
          await importer.abort();
        }
      });

      const jobState = await stateStore.getJobState(importer.getJobId());
      expect(jobState).not.toBeNull();
      expect(jobState!.status).toBe('ABORTED');
    });
  });

  // --- Concurrent batch processing with abort ---

  describe('concurrent processing abort', () => {
    it('should abort during concurrent batch processing', async () => {
      const csv = 'email,name\na@t.com,A\nb@t.com,B\nc@t.com,C\nd@t.com,D\ne@t.com,E\nf@t.com,F';
      const importer = createImporter({ batchSize: 2, maxConcurrentBatches: 3 });
      importer.from(new BufferSource(csv), new CsvParser());

      let count = 0;
      await importer.start(async () => {
        count++;
        if (count === 2) {
          await importer.abort();
        }
      });

      expect(importer.getStatus().status).toBe('ABORTED');
    });
  });

  // --- Retry ---

  describe('retry with non-Error throw', () => {
    it('should handle non-Error throw during retries', async () => {
      const csv = 'email,name\na@test.com,Alice';
      const importer = new BulkImport({
        schema,
        batchSize: 10,
        maxRetries: 1,
        retryDelayMs: 0,
        continueOnError: true,
      });
      importer.from(new BufferSource(csv), new CsvParser());

      await importer.start(async () => {
        await Promise.resolve();
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 42;
      });

      const failed = await importer.getFailedRecords();
      expect(failed).toHaveLength(1);
      expect(failed[0]?.processingError).toBe('42');
      expect(failed[0]?.retryCount).toBe(1);
    });
  });

  describe('retry with exponential backoff timing', () => {
    it('should apply exponential backoff delays', async () => {
      const csv = 'email,name\na@test.com,Alice';
      const importer = new BulkImport({
        schema,
        batchSize: 10,
        maxRetries: 2,
        retryDelayMs: 50,
        continueOnError: true,
      });
      importer.from(new BufferSource(csv), new CsvParser());

      const start = Date.now();
      await importer.start(async () => {
        await Promise.resolve();
        throw new Error('Always fails');
      });
      const elapsed = Date.now() - start;

      // Delay: 50ms (attempt 1) + 100ms (attempt 2) = 150ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(130);

      const failed = await importer.getFailedRecords();
      expect(failed).toHaveLength(1);
    });
  });
});
