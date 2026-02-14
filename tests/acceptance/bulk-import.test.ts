import { describe, it, expect } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import type {
  ImportCompletedEvent,
  BatchCompletedEvent,
  RecordFailedEvent,
} from '../../src/domain/events/DomainEvents.js';
import type { RawRecord } from '../../src/domain/model/Record.js';

// --- Helpers ---

function generateCsv(count: number, includeInvalid = false): string {
  const header = 'email,name,age';
  const rows: string[] = [];
  for (let i = 1; i <= count; i++) {
    if (includeInvalid && i % 4 === 0) {
      rows.push(`not-an-email,User ${String(i)},${String(i * 10)}`);
    } else {
      rows.push(`user${String(i)}@test.com,User ${String(i)},${String(i * 10)}`);
    }
  }
  return [header, ...rows].join('\n');
}

function createImporter(options?: { batchSize?: number; continueOnError?: boolean; strict?: boolean }) {
  return new BulkImport({
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number', required: false },
      ],
      strict: options?.strict ?? false,
    },
    batchSize: options?.batchSize ?? 10,
    continueOnError: options?.continueOnError ?? false,
  });
}

// ============================================================
// TEST 1: Full happy path
// ============================================================
describe('Test 1: Full happy path', () => {
  it('should process all records in batches and emit correct events', async () => {
    const csv = generateCsv(25);
    const importer = createImporter({ batchSize: 10 });
    importer.from(new BufferSource(csv), new CsvParser());

    // Preview
    const preview = await importer.preview(5);
    expect(preview.validRecords).toHaveLength(5);
    expect(preview.invalidRecords).toHaveLength(0);
    expect(preview.totalSampled).toBe(5);

    // Collect events
    const events: string[] = [];
    const batchCompleted: BatchCompletedEvent[] = [];
    const completedEvents: ImportCompletedEvent[] = [];

    importer.on('import:started', () => events.push('import:started'));
    importer.on('batch:completed', (e) => {
      events.push('batch:completed');
      batchCompleted.push(e);
    });
    importer.on('import:completed', (e) => {
      events.push('import:completed');
      completedEvents.push(e);
    });

    // Start
    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Assertions
    expect(processed).toHaveLength(25);
    expect(batchCompleted).toHaveLength(3); // 10 + 10 + 5
    expect(batchCompleted[0]?.processedCount).toBe(10);
    expect(batchCompleted[1]?.processedCount).toBe(10);
    expect(batchCompleted[2]?.processedCount).toBe(5);

    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]?.summary.total).toBe(25);
    expect(completedEvents[0]?.summary.processed).toBe(25);
    expect(completedEvents[0]?.summary.failed).toBe(0);

    const status = importer.getStatus();
    expect(status.state).toBe('COMPLETED');
    expect(status.progress.percentage).toBe(100);
  });
});

// ============================================================
// TEST 2: Records with validation errors
// ============================================================
describe('Test 2: Records with validation errors', () => {
  it('should skip invalid records and track failures when continueOnError is true', async () => {
    // Generate 12 records: indices 4, 8, 12 will have invalid emails (every 4th)
    const csv = generateCsv(12, true);
    const importer = createImporter({ batchSize: 20, continueOnError: true });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    const failedEvents: RecordFailedEvent[] = [];

    importer.on('record:failed', (e) => failedEvents.push(e));

    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // 3 invalid out of 12 (indices 4, 8, 12)
    expect(processed).toHaveLength(9);
    expect(failedEvents).toHaveLength(3);

    const failed = importer.getFailedRecords();
    expect(failed).toHaveLength(3);
    expect(failed.every((r) => r.errors.length > 0)).toBe(true);

    const status = importer.getStatus();
    expect(status.state).toBe('COMPLETED');
  });
});

// ============================================================
// TEST 3: Pause and Resume
// ============================================================
describe('Test 3: Pause and Resume', () => {
  it('should pause processing and resume from where it left off', async () => {
    const csv = generateCsv(50);
    const importer = createImporter({ batchSize: 10 });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    let batchesCompleted = 0;

    importer.on('batch:completed', () => {
      batchesCompleted++;
      // Pause after 2 batches
      if (batchesCompleted === 2) {
        void importer.pause();
      }
    });

    // Start in background (don't await yet)
    const startPromise = importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Wait a bit for batches to process, then check state
    await new Promise((resolve) => setTimeout(resolve, 100));

    const statusWhilePaused = importer.getStatus();
    expect(statusWhilePaused.state).toBe('PAUSED');
    expect(processed.length).toBeGreaterThanOrEqual(20);
    const countBeforeResume = processed.length;

    // Resume
    importer.resume();

    // Wait for completion
    await startPromise;

    expect(processed).toHaveLength(50);
    expect(processed.length).toBeGreaterThan(countBeforeResume);

    const finalStatus = importer.getStatus();
    expect(finalStatus.state).toBe('COMPLETED');
  });
});

// ============================================================
// TEST 4: Abort
// ============================================================
describe('Test 4: Abort', () => {
  it('should stop processing and prevent resume after abort', async () => {
    const csv = generateCsv(50);
    const importer = createImporter({ batchSize: 10 });
    importer.from(new BufferSource(csv), new CsvParser());

    let batchesCompleted = 0;

    importer.on('batch:completed', () => {
      batchesCompleted++;
      if (batchesCompleted === 1) {
        void importer.abort();
      }
    });

    await importer.start(async () => {
      await Promise.resolve();
    });

    const status = importer.getStatus();
    expect(status.state).toBe('ABORTED');

    // Attempting to resume should throw
    expect(() => { importer.resume(); }).toThrow('Cannot resume an aborted import');
  });
});

// ============================================================
// TEST 5: Error in consumer processor
// ============================================================
describe('Test 5: Error in consumer processor', () => {
  it('should capture processor errors and continue when continueOnError is true', async () => {
    const csv = generateCsv(10);
    const importer = createImporter({ batchSize: 20, continueOnError: true });
    importer.from(new BufferSource(csv), new CsvParser());

    let callCount = 0;
    await importer.start(async () => {
      callCount++;
      if (callCount === 5) {
        throw new Error('DB connection lost');
      }
      await Promise.resolve();
    });

    const status = importer.getStatus();
    expect(status.state).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(9);
    expect(status.progress.failedRecords).toBe(1);

    const failed = importer.getFailedRecords();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.processingError).toBe('DB connection lost');
  });
});

// ============================================================
// TEST 7: Preview with invalid records
// ============================================================
describe('Test 7: Preview with invalid records', () => {
  it('should clearly separate valid and invalid records in preview', async () => {
    const csv = generateCsv(10, true);
    const importer = createImporter({ batchSize: 20 });
    importer.from(new BufferSource(csv), new CsvParser());

    const preview = await importer.preview(10);

    expect(preview.totalSampled).toBe(10);
    expect(preview.validRecords.length + preview.invalidRecords.length).toBe(10);
    expect(preview.invalidRecords.length).toBeGreaterThan(0);

    // Each invalid record should have error details
    for (const record of preview.invalidRecords) {
      expect(record.errors.length).toBeGreaterThan(0);
      expect(record.raw).toBeDefined();
    }

    // Columns should be detected
    expect(preview.columns).toContain('email');
    expect(preview.columns).toContain('name');
    expect(preview.columns).toContain('age');
  });
});

// ============================================================
// TEST 8: Multiple data sources
// ============================================================
describe('Test 8: Multiple data sources', () => {
  it('should produce the same result regardless of data source', async () => {
    const csv = 'email,name,age\ntest@test.com,Test User,30';

    // Source 1: string buffer
    const importer1 = createImporter({ batchSize: 10 });
    importer1.from(new BufferSource(csv), new CsvParser());
    const processed1: RawRecord[] = [];
    await importer1.start(async (record) => {
      processed1.push(record);
      await Promise.resolve();
    });

    // Source 2: Buffer object
    const importer2 = createImporter({ batchSize: 10 });
    importer2.from(new BufferSource(Buffer.from(csv)), new CsvParser());
    const processed2: RawRecord[] = [];
    await importer2.start(async (record) => {
      processed2.push(record);
      await Promise.resolve();
    });

    expect(processed1).toHaveLength(1);
    expect(processed2).toHaveLength(1);
    expect(processed1[0]).toEqual(processed2[0]);
  });
});

// ============================================================
// TEST 9: Custom validator
// ============================================================
describe('Test 9: Custom field validator', () => {
  it('should use custom validators and report CUSTOM_VALIDATION errors', async () => {
    const csv = 'nif,name\n12345678Z,Alice\nINVALID,Bob\n87654321X,Charlie';

    const nifPattern = /^\d{8}[A-Z]$/;

    const importer = new BulkImport({
      schema: {
        fields: [
          {
            name: 'nif',
            type: 'custom',
            required: true,
            customValidator: (value) => {
              const valid = nifPattern.test(String(value));
              return { valid, message: valid ? undefined : 'Invalid NIF format' };
            },
          },
          { name: 'name', type: 'string', required: true },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(2); // Alice and Charlie
    const failed = importer.getFailedRecords();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.errors[0]?.code).toBe('CUSTOM_VALIDATION');
    expect(failed[0]?.errors[0]?.message).toBe('Invalid NIF format');
  });
});

// ============================================================
// TEST 10: Granular events in correct order
// ============================================================
describe('Test 10: Granular events in correct order', () => {
  it('should emit events in the correct lifecycle order', async () => {
    const csv = generateCsv(20);
    const importer = createImporter({ batchSize: 10 });
    importer.from(new BufferSource(csv), new CsvParser());

    const eventOrder: string[] = [];

    importer.on('import:started', () => eventOrder.push('import:started'));
    importer.on('batch:started', () => eventOrder.push('batch:started'));
    importer.on('batch:completed', () => eventOrder.push('batch:completed'));
    importer.on('record:processed', () => eventOrder.push('record:processed'));
    importer.on('import:completed', () => eventOrder.push('import:completed'));
    importer.on('import:progress', () => eventOrder.push('import:progress'));

    await importer.start(async () => {
      await Promise.resolve();
    });

    // Verify order
    expect(eventOrder[0]).toBe('import:started');
    expect(eventOrder[eventOrder.length - 1]).toBe('import:completed');

    // Should have batch:started before its records and batch:completed
    const firstBatchStart = eventOrder.indexOf('batch:started');
    const firstBatchEnd = eventOrder.indexOf('batch:completed');
    const firstRecordProcessed = eventOrder.indexOf('record:processed');

    expect(firstBatchStart).toBeLessThan(firstRecordProcessed);
    expect(firstRecordProcessed).toBeLessThan(firstBatchEnd);

    // Should have 2 batch:started and 2 batch:completed
    expect(eventOrder.filter((e) => e === 'batch:started')).toHaveLength(2);
    expect(eventOrder.filter((e) => e === 'batch:completed')).toHaveLength(2);

    // Should have 20 record:processed events
    expect(eventOrder.filter((e) => e === 'record:processed')).toHaveLength(20);

    // Should have progress events after each batch
    expect(eventOrder.filter((e) => e === 'import:progress')).toHaveLength(2);
  });
});
