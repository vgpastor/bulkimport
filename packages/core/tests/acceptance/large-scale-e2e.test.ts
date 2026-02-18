import { describe, it, expect, vi } from 'vitest';
import { BatchEngine } from '../../src/BatchEngine.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import type { DomainEvent, JobProgressEvent } from '../../src/domain/events/DomainEvents.js';
import type { RawRecord, ParsedRecord } from '../../src/domain/model/Record.js';

// --- Helpers ---

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

function generateLargeCsv(count: number, options?: { invalidEvery?: number }): string {
  const invalidEvery = options?.invalidEvery ?? 0;

  const header = 'email,name,age';
  const rows: string[] = [];

  for (let i = 1; i <= count; i++) {
    const isInvalid = invalidEvery > 0 && i % invalidEvery === 0;
    const email = isInvalid ? 'bad-email' : `user${String(i)}@test.com`;
    const name = `User ${String(i)}`;
    const age = String(i * 10);
    rows.push(`${email},${name},${age}`);
  }

  return [header, ...rows].join('\n');
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailValidator(record: RawRecord) {
  const email = (record.email as string | undefined) ?? '';
  if (!emailRegex.test(email)) {
    return {
      isValid: false,
      errors: [{ field: 'email', message: 'Invalid email', code: 'TYPE_MISMATCH' as const }],
    };
  }
  return { isValid: true, errors: [] };
}

// ============================================================
// Large-scale e2e: 1500 records, full lifecycle
// ============================================================
describe('Large-scale e2e: 1500 records', () => {
  // -----------------------------------------------------------
  // Scenario 1: Happy path — 1500 valid records, sequential
  // -----------------------------------------------------------
  describe('Scenario 1: happy path with 1500 valid records', () => {
    it('should process all 1500 records across 8 batches', async () => {
      const totalRecords = 1500;
      const batchSize = 200;
      const expectedBatches = Math.ceil(totalRecords / batchSize); // 8

      const csv = generateLargeCsv(totalRecords);
      const engine = new BatchEngine({ batchSize });
      engine.from(new BufferSource(csv), simpleCsvParser());

      // count() before start()
      const count = await engine.count();
      expect(count).toBe(totalRecords);

      // Re-attach source (count() consumed the stream)
      engine.from(new BufferSource(csv), simpleCsvParser());

      // Track events via onAny()
      const allEvents: DomainEvent[] = [];
      engine.onAny((event) => allEvents.push(event));

      // Process
      const processed: ParsedRecord[] = [];
      await engine.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      // All records processed
      expect(processed).toHaveLength(totalRecords);

      // Status is COMPLETED
      const { status, progress } = engine.getStatus();
      expect(status).toBe('COMPLETED');
      expect(progress.totalRecords).toBe(totalRecords);
      expect(progress.processedRecords).toBe(totalRecords);
      expect(progress.failedRecords).toBe(0);
      expect(progress.percentage).toBe(100);
      expect(progress.totalBatches).toBe(expectedBatches);
      expect(progress.currentBatch).toBe(expectedBatches);

      // Event sequence validation
      const eventTypes = allEvents.map((e) => e.type);

      // Starts with job:started
      expect(eventTypes[0]).toBe('job:started');

      // Ends with job:completed
      expect(eventTypes[eventTypes.length - 1]).toBe('job:completed');

      // Correct number of batch events
      const batchStarted = allEvents.filter((e) => e.type === 'batch:started');
      const batchCompleted = allEvents.filter((e) => e.type === 'batch:completed');
      expect(batchStarted).toHaveLength(expectedBatches);
      expect(batchCompleted).toHaveLength(expectedBatches);

      // Progress events emitted after each batch
      const progressEvents = allEvents.filter((e): e is JobProgressEvent => e.type === 'job:progress');
      expect(progressEvents).toHaveLength(expectedBatches);

      // Progress percentage generally increases (processedRecords grows monotonically)
      for (let i = 1; i < progressEvents.length; i++) {
        const prev = progressEvents[i - 1]!.progress.processedRecords;
        const curr = progressEvents[i]!.progress.processedRecords;
        expect(curr).toBeGreaterThanOrEqual(prev);
      }

      // Last progress is 100%
      expect(progressEvents[progressEvents.length - 1]!.progress.percentage).toBe(100);

      // record:processed events match total
      const recordProcessed = allEvents.filter((e) => e.type === 'record:processed');
      expect(recordProcessed).toHaveLength(totalRecords);
    });
  });

  // -----------------------------------------------------------
  // Scenario 2: Mixed valid/invalid — continueOnError
  // -----------------------------------------------------------
  describe('Scenario 2: 1500 records with invalid records every 10th row', () => {
    it('should process valid records, skip invalid, and track failures', async () => {
      const totalRecords = 1500;
      const invalidEvery = 10; // every 10th row has a bad email
      const expectedInvalid = Math.floor(totalRecords / invalidEvery); // 150
      const expectedValid = totalRecords - expectedInvalid; // 1350
      const batchSize = 200;

      const csv = generateLargeCsv(totalRecords, { invalidEvery });
      const engine = new BatchEngine({
        batchSize,
        continueOnError: true,
        validate: emailValidator,
      });
      engine.from(new BufferSource(csv), simpleCsvParser());

      const processed: ParsedRecord[] = [];
      const failedIndices: number[] = [];

      engine.on('record:failed', (e) => {
        failedIndices.push(e.recordIndex);
      });

      await engine.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      expect(processed).toHaveLength(expectedValid);

      const { status, progress } = engine.getStatus();
      expect(status).toBe('COMPLETED');
      expect(progress.totalRecords).toBe(totalRecords);
      expect(progress.processedRecords).toBe(expectedValid);
      expect(progress.failedRecords).toBe(expectedInvalid);
      expect(progress.percentage).toBe(100);

      // Failed records are at correct indices (every 10th, 0-indexed: 9, 19, 29...)
      expect(failedIndices).toHaveLength(expectedInvalid);
      for (const idx of failedIndices) {
        expect((idx + 1) % invalidEvery).toBe(0);
      }

      // getFailedRecords() returns all failures
      const failedRecords = await engine.getFailedRecords();
      expect(failedRecords).toHaveLength(expectedInvalid);
    });
  });

  // -----------------------------------------------------------
  // Scenario 3: Concurrent batch processing
  // -----------------------------------------------------------
  describe('Scenario 3: 1200 records with concurrent batches', () => {
    it('should process all records with maxConcurrentBatches=4', async () => {
      const totalRecords = 1200;
      const batchSize = 150;
      const expectedBatches = Math.ceil(totalRecords / batchSize); // 8
      const concurrency = 4;

      const csv = generateLargeCsv(totalRecords);
      const engine = new BatchEngine({
        batchSize,
        maxConcurrentBatches: concurrency,
      });
      engine.from(new BufferSource(csv), simpleCsvParser());

      const processedEmails = new Set<unknown>();
      const batchCompletionOrder: number[] = [];

      engine.on('batch:completed', (e) => {
        batchCompletionOrder.push(e.batchIndex);
      });

      await engine.start(async (record) => {
        processedEmails.add(record.email);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // All unique records processed
      expect(processedEmails.size).toBe(totalRecords);

      const { status, progress } = engine.getStatus();
      expect(status).toBe('COMPLETED');
      expect(progress.processedRecords).toBe(totalRecords);
      expect(progress.totalBatches).toBe(expectedBatches);

      // All batches completed
      expect(batchCompletionOrder).toHaveLength(expectedBatches);
    });
  });

  // -----------------------------------------------------------
  // Scenario 4: onAny() relay — verify full event stream
  // -----------------------------------------------------------
  describe('Scenario 4: onAny() captures complete event stream for 1000 records', () => {
    it('should relay all events in correct order via onAny()', async () => {
      const totalRecords = 1000;
      const batchSize = 250;
      const expectedBatches = Math.ceil(totalRecords / batchSize); // 4

      const csv = generateLargeCsv(totalRecords);
      const engine = new BatchEngine({ batchSize });
      engine.from(new BufferSource(csv), simpleCsvParser());

      const eventStream: string[] = [];
      engine.onAny((event) => {
        eventStream.push(event.type);
      });

      await engine.start(async () => {
        await Promise.resolve();
      });

      // First event is job:started
      expect(eventStream[0]).toBe('job:started');

      // Last event is job:completed
      expect(eventStream[eventStream.length - 1]).toBe('job:completed');

      // For each batch: batch:started → N×record:processed → batch:completed → job:progress
      // Total events: 1 (started) + 4×(1 + 250 + 1 + 1) + 1 (completed) = 1014
      const expectedTotal =
        1 + // job:started
        expectedBatches * (1 + batchSize + 1 + 1) + // batch:started + records + batch:completed + job:progress
        1; // job:completed
      expect(eventStream).toHaveLength(expectedTotal);

      // Each batch:started is followed by record:processed events then batch:completed
      let pos = 1; // skip job:started
      for (let b = 0; b < expectedBatches; b++) {
        expect(eventStream[pos]).toBe('batch:started');
        pos++;
        for (let r = 0; r < batchSize; r++) {
          expect(eventStream[pos]).toBe('record:processed');
          pos++;
        }
        expect(eventStream[pos]).toBe('batch:completed');
        pos++;
        expect(eventStream[pos]).toBe('job:progress');
        pos++;
      }
      expect(eventStream[pos]).toBe('job:completed');
    });
  });

  // -----------------------------------------------------------
  // Scenario 5: count() matches actual processed records
  // -----------------------------------------------------------
  describe('Scenario 5: count() consistency with start()', () => {
    it('should return the same total from count() and after start()', async () => {
      const totalRecords = 1500;
      const csv = generateLargeCsv(totalRecords);

      const engine = new BatchEngine({ batchSize: 300 });
      engine.from(new BufferSource(csv), simpleCsvParser());

      const counted = await engine.count();

      // Re-attach source
      engine.from(new BufferSource(csv), simpleCsvParser());

      let processedCount = 0;
      await engine.start(async () => {
        processedCount++;
        await Promise.resolve();
      });

      expect(counted).toBe(processedCount);
      expect(counted).toBe(totalRecords);
      expect(engine.getStatus().progress.totalRecords).toBe(totalRecords);
    });
  });

  // -----------------------------------------------------------
  // Scenario 6: Mixed errors + concurrency + progress tracking
  // -----------------------------------------------------------
  describe('Scenario 6: 2000 records with errors, concurrency, and full progress', () => {
    it('should handle concurrent batches with mixed valid/invalid records', async () => {
      const totalRecords = 2000;
      const invalidEvery = 20; // every 20th row
      const expectedInvalid = Math.floor(totalRecords / invalidEvery); // 100
      const expectedValid = totalRecords - expectedInvalid; // 1900
      const batchSize = 250;
      const expectedBatches = Math.ceil(totalRecords / batchSize); // 8
      const concurrency = 3;

      const csv = generateLargeCsv(totalRecords, { invalidEvery });
      const engine = new BatchEngine({
        batchSize,
        continueOnError: true,
        maxConcurrentBatches: concurrency,
        validate: emailValidator,
      });
      engine.from(new BufferSource(csv), simpleCsvParser());

      // Track progress percentages
      const progressSnapshots: number[] = [];
      engine.on('job:progress', (e) => {
        progressSnapshots.push(e.progress.percentage);
      });

      // Track all events via onAny
      let eventCount = 0;
      engine.onAny(() => {
        eventCount++;
      });

      const processed: ParsedRecord[] = [];
      await engine.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      // Correct counts
      expect(processed).toHaveLength(expectedValid);

      const { status, progress } = engine.getStatus();
      expect(status).toBe('COMPLETED');
      expect(progress.totalRecords).toBe(totalRecords);
      expect(progress.processedRecords).toBe(expectedValid);
      expect(progress.failedRecords).toBe(expectedInvalid);
      expect(progress.percentage).toBe(100);
      expect(progress.totalBatches).toBe(expectedBatches);

      // Progress was reported for each batch
      expect(progressSnapshots).toHaveLength(expectedBatches);

      // Final progress is 100%
      expect(progressSnapshots[progressSnapshots.length - 1]).toBe(100);

      // Events were captured (at minimum: started + batches + records + completed)
      expect(eventCount).toBeGreaterThan(totalRecords);

      // Failed records retrievable
      const failed = await engine.getFailedRecords();
      expect(failed).toHaveLength(expectedInvalid);
    });
  });

  // -----------------------------------------------------------
  // Scenario 7: Deferred job:started with large import
  // -----------------------------------------------------------
  describe('Scenario 7: deferred job:started at scale', () => {
    it('should deliver job:started to handler registered after start()', async () => {
      const totalRecords = 1000;
      const csv = generateLargeCsv(totalRecords);
      const engine = new BatchEngine({ batchSize: 500 });
      engine.from(new BufferSource(csv), simpleCsvParser());

      const handler = vi.fn();

      // Start without awaiting, then register handler
      const promise = engine.start(async () => {
        await Promise.resolve();
      });

      engine.on('job:started', handler);

      await promise;

      expect(handler).toHaveBeenCalledOnce();
      expect(engine.getStatus().status).toBe('COMPLETED');
      expect(engine.getStatus().progress.processedRecords).toBe(totalRecords);
    });
  });
});
