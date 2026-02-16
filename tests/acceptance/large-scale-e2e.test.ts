import { describe, it, expect, vi } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import type { DomainEvent, ImportProgressEvent } from '../../src/domain/events/DomainEvents.js';
import type { ParsedRecord } from '../../src/domain/model/Record.js';

// --- Helpers ---

function generateLargeCsv(count: number, options?: { invalidEvery?: number; withZones?: boolean }): string {
  const invalidEvery = options?.invalidEvery ?? 0;
  const withZones = options?.withZones ?? false;

  const header = withZones ? 'email,name,age,zones' : 'email,name,age';
  const rows: string[] = [];

  for (let i = 1; i <= count; i++) {
    const isInvalid = invalidEvery > 0 && i % invalidEvery === 0;
    const email = isInvalid ? 'bad-email' : `user${String(i)}@test.com`;
    const name = `User ${String(i)}`;
    const age = String(i * 10);
    const zones = withZones ? `,"zone-${String((i % 3) + 1)};zone-${String((i % 5) + 1)}"` : '';
    rows.push(`${email},${name},${age}${zones}`);
  }

  return [header, ...rows].join('\n');
}

function createLargeImporter(options: {
  batchSize: number;
  continueOnError?: boolean;
  maxConcurrentBatches?: number;
  withZones?: boolean;
}) {
  const fields = [
    { name: 'email', type: 'email' as const, required: true },
    { name: 'name', type: 'string' as const, required: true },
    { name: 'age', type: 'number' as const, required: false },
  ];

  if (options.withZones) {
    fields.push({
      name: 'zones',
      type: 'array' as const,
      required: false,
      separator: ';',
      itemTransform: (s: string) => s.toLowerCase(),
    } as (typeof fields)[number]);
  }

  return new BulkImport({
    schema: { fields },
    batchSize: options.batchSize,
    continueOnError: options.continueOnError ?? false,
    maxConcurrentBatches: options.maxConcurrentBatches ?? 1,
  });
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
      const importer = createLargeImporter({ batchSize });
      importer.from(new BufferSource(csv), new CsvParser());

      // count() before start()
      const count = await importer.count();
      expect(count).toBe(totalRecords);

      // Re-attach source (count() consumed the stream)
      importer.from(new BufferSource(csv), new CsvParser());

      // Track events via onAny()
      const allEvents: DomainEvent[] = [];
      importer.onAny((event) => allEvents.push(event));

      // Process
      const processed: ParsedRecord[] = [];
      await importer.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      // All records processed
      expect(processed).toHaveLength(totalRecords);

      // Status is COMPLETED
      const { status, progress } = importer.getStatus();
      expect(status).toBe('COMPLETED');
      expect(progress.totalRecords).toBe(totalRecords);
      expect(progress.processedRecords).toBe(totalRecords);
      expect(progress.failedRecords).toBe(0);
      expect(progress.percentage).toBe(100);
      expect(progress.totalBatches).toBe(expectedBatches);
      expect(progress.currentBatch).toBe(expectedBatches);

      // Event sequence validation
      const eventTypes = allEvents.map((e) => e.type);

      // Starts with import:started
      expect(eventTypes[0]).toBe('import:started');

      // Ends with import:completed
      expect(eventTypes[eventTypes.length - 1]).toBe('import:completed');

      // Correct number of batch events
      const batchStarted = allEvents.filter((e) => e.type === 'batch:started');
      const batchCompleted = allEvents.filter((e) => e.type === 'batch:completed');
      expect(batchStarted).toHaveLength(expectedBatches);
      expect(batchCompleted).toHaveLength(expectedBatches);

      // Progress events emitted after each batch
      const progressEvents = allEvents.filter((e): e is ImportProgressEvent => e.type === 'import:progress');
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
      const importer = createLargeImporter({ batchSize, continueOnError: true });
      importer.from(new BufferSource(csv), new CsvParser());

      const processed: ParsedRecord[] = [];
      const failedIndices: number[] = [];

      importer.on('record:failed', (e) => {
        failedIndices.push(e.recordIndex);
      });

      await importer.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      expect(processed).toHaveLength(expectedValid);

      const { status, progress } = importer.getStatus();
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
      const failedRecords = await importer.getFailedRecords();
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
      const importer = createLargeImporter({
        batchSize,
        maxConcurrentBatches: concurrency,
      });
      importer.from(new BufferSource(csv), new CsvParser());

      const processedEmails = new Set<unknown>();
      const batchCompletionOrder: number[] = [];

      importer.on('batch:completed', (e) => {
        batchCompletionOrder.push(e.batchIndex);
      });

      await importer.start(async (record) => {
        processedEmails.add(record.email);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // All unique records processed
      expect(processedEmails.size).toBe(totalRecords);

      const { status, progress } = importer.getStatus();
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
      const importer = createLargeImporter({ batchSize });
      importer.from(new BufferSource(csv), new CsvParser());

      const eventStream: string[] = [];
      importer.onAny((event) => {
        eventStream.push(event.type);
      });

      await importer.start(async () => {
        await Promise.resolve();
      });

      // First event is import:started
      expect(eventStream[0]).toBe('import:started');

      // Last event is import:completed
      expect(eventStream[eventStream.length - 1]).toBe('import:completed');

      // For each batch: batch:started → N×record:processed → batch:completed → import:progress
      // Total events: 1 (started) + 4×(1 + 250 + 1 + 1) + 1 (completed) = 1014
      const expectedTotal =
        1 + // import:started
        expectedBatches * (1 + batchSize + 1 + 1) + // batch:started + records + batch:completed + import:progress
        1; // import:completed
      expect(eventStream).toHaveLength(expectedTotal);

      // Each batch:started is followed by record:processed events then batch:completed
      let pos = 1; // skip import:started
      for (let b = 0; b < expectedBatches; b++) {
        expect(eventStream[pos]).toBe('batch:started');
        pos++;
        for (let r = 0; r < batchSize; r++) {
          expect(eventStream[pos]).toBe('record:processed');
          pos++;
        }
        expect(eventStream[pos]).toBe('batch:completed');
        pos++;
        expect(eventStream[pos]).toBe('import:progress');
        pos++;
      }
      expect(eventStream[pos]).toBe('import:completed');
    });
  });

  // -----------------------------------------------------------
  // Scenario 5: count() matches actual processed records
  // -----------------------------------------------------------
  describe('Scenario 5: count() consistency with start()', () => {
    it('should return the same total from count() and after start()', async () => {
      const totalRecords = 1500;
      const csv = generateLargeCsv(totalRecords);

      const importer = createLargeImporter({ batchSize: 300 });
      importer.from(new BufferSource(csv), new CsvParser());

      const counted = await importer.count();

      // Re-attach source
      importer.from(new BufferSource(csv), new CsvParser());

      let processedCount = 0;
      await importer.start(async () => {
        processedCount++;
        await Promise.resolve();
      });

      expect(counted).toBe(processedCount);
      expect(counted).toBe(totalRecords);
      expect(importer.getStatus().progress.totalRecords).toBe(totalRecords);
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
      const importer = createLargeImporter({
        batchSize,
        continueOnError: true,
        maxConcurrentBatches: concurrency,
      });
      importer.from(new BufferSource(csv), new CsvParser());

      // Track progress percentages
      const progressSnapshots: number[] = [];
      importer.on('import:progress', (e) => {
        progressSnapshots.push(e.progress.percentage);
      });

      // Track all events via onAny
      let eventCount = 0;
      importer.onAny(() => {
        eventCount++;
      });

      const processed: ParsedRecord[] = [];
      await importer.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      // Correct counts
      expect(processed).toHaveLength(expectedValid);

      const { status, progress } = importer.getStatus();
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
      const failed = await importer.getFailedRecords();
      expect(failed).toHaveLength(expectedInvalid);
    });
  });

  // -----------------------------------------------------------
  // Scenario 7: Deferred import:started with large import
  // -----------------------------------------------------------
  describe('Scenario 7: deferred import:started at scale', () => {
    it('should deliver import:started to handler registered after start()', async () => {
      const totalRecords = 1000;
      const csv = generateLargeCsv(totalRecords);
      const importer = createLargeImporter({ batchSize: 500 });
      importer.from(new BufferSource(csv), new CsvParser());

      const handler = vi.fn();

      // Start without awaiting, then register handler
      const promise = importer.start(async () => {
        await Promise.resolve();
      });

      importer.on('import:started', handler);

      await promise;

      expect(handler).toHaveBeenCalledOnce();
      expect(importer.getStatus().status).toBe('COMPLETED');
      expect(importer.getStatus().progress.processedRecords).toBe(totalRecords);
    });
  });

  // -----------------------------------------------------------
  // Scenario 8: itemTransform + array fields at scale
  // -----------------------------------------------------------
  describe('Scenario 8: array fields with itemTransform across 1000 records', () => {
    it('should apply itemTransform to every record across all batches', async () => {
      const totalRecords = 1000;
      const batchSize = 200;

      const csv = generateLargeCsv(totalRecords, { withZones: true });
      const importer = createLargeImporter({ batchSize, withZones: true });
      importer.from(new BufferSource(csv), new CsvParser());

      const zones: unknown[] = [];
      await importer.start(async (record) => {
        zones.push(record.zones);
        await Promise.resolve();
      });

      expect(zones).toHaveLength(totalRecords);

      // Every record's zones should be an array of lowercase strings
      for (const z of zones) {
        expect(Array.isArray(z)).toBe(true);
        for (const item of z as string[]) {
          expect(item).toBe(item.toLowerCase());
          expect(item.startsWith('zone-')).toBe(true);
        }
      }

      expect(importer.getStatus().status).toBe('COMPLETED');
    });
  });
});
