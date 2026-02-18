import { describe, it, expect } from 'vitest';
import { BatchEngine } from '../../src/BatchEngine.js';
import type { BatchEngineConfig } from '../../src/BatchEngine.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import { InMemoryStateStore } from '../../src/infrastructure/state/InMemoryStateStore.js';
import type { ChunkCompletedEvent } from '../../src/domain/events/DomainEvents.js';
import type { RawRecord } from '../../src/domain/model/Record.js';

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

function createConfig(overrides?: Partial<BatchEngineConfig>): BatchEngineConfig {
  return {
    batchSize: 5,
    continueOnError: false,
    ...overrides,
  };
}

// ============================================================
// processChunk() — Serverless chunk processing
// ============================================================
describe('processChunk()', () => {
  it('should process all records in a single chunk when no limits are set', async () => {
    const csv = generateCsv(10);
    const engine = new BatchEngine(createConfig());
    engine.from(new BufferSource(csv), simpleCsvParser());

    const processed: RawRecord[] = [];
    const result = await engine.processChunk(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(result.done).toBe(true);
    expect(result.processedRecords).toBe(10);
    expect(result.failedRecords).toBe(0);
    expect(result.totalProcessed).toBe(10);
    expect(result.totalFailed).toBe(0);
    expect(result.jobId).toBeTruthy();
    expect(processed).toHaveLength(10);
  });

  it('should stop after maxRecords and return done=false', async () => {
    const csv = generateCsv(25);
    const stateStore = new InMemoryStateStore();
    const engine = new BatchEngine(createConfig({ stateStore, batchSize: 5 }));
    engine.from(new BufferSource(csv), simpleCsvParser());

    const processed: RawRecord[] = [];
    const result = await engine.processChunk(
      async (record) => {
        processed.push(record);
        await Promise.resolve();
      },
      { maxRecords: 10 },
    );

    expect(result.done).toBe(false);
    expect(result.processedRecords).toBe(10);
    expect(result.totalProcessed).toBe(10);
    expect(processed).toHaveLength(10);
  });

  it('should complete remaining records in a second chunk call', async () => {
    const csv = generateCsv(25);
    const stateStore = new InMemoryStateStore();
    const engine = new BatchEngine(createConfig({ stateStore, batchSize: 5 }));
    engine.from(new BufferSource(csv), simpleCsvParser());

    // First chunk: process 10 records
    const allProcessed: RawRecord[] = [];
    const result1 = await engine.processChunk(
      async (record) => {
        allProcessed.push(record);
        await Promise.resolve();
      },
      { maxRecords: 10 },
    );

    expect(result1.done).toBe(false);
    expect(result1.processedRecords).toBe(10);

    // Second chunk: process remaining — same instance
    engine.from(new BufferSource(csv), simpleCsvParser());
    const result2 = await engine.processChunk(
      async (record) => {
        allProcessed.push(record);
        await Promise.resolve();
      },
      { maxRecords: 100 },
    );

    expect(result2.done).toBe(true);
    expect(result2.processedRecords).toBe(15);
    expect(result2.totalProcessed).toBe(25);
    expect(allProcessed).toHaveLength(25);
  });

  it('should stop after maxDurationMs', async () => {
    const csv = generateCsv(100);
    const stateStore = new InMemoryStateStore();
    const engine = new BatchEngine(createConfig({ stateStore, batchSize: 5 }));
    engine.from(new BufferSource(csv), simpleCsvParser());

    const result = await engine.processChunk(
      async () => {
        // Simulate slow processing: 20ms per record
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      { maxDurationMs: 150 },
    );

    // Should have processed some but not all records
    expect(result.done).toBe(false);
    expect(result.processedRecords).toBeGreaterThan(0);
    expect(result.processedRecords).toBeLessThan(100);
  });

  it('should work with restore() between chunks', async () => {
    const csv = generateCsv(25);
    const stateStore = new InMemoryStateStore();
    const config = createConfig({ stateStore, batchSize: 5 });

    // First chunk
    const engine1 = new BatchEngine(config);
    engine1.from(new BufferSource(csv), simpleCsvParser());

    const result1 = await engine1.processChunk(
      async () => {
        await Promise.resolve();
      },
      { maxRecords: 10 },
    );

    expect(result1.done).toBe(false);
    const jobId = result1.jobId;

    // Restore and continue — simulates a new serverless invocation
    const engine2 = await BatchEngine.restore(jobId, config);
    expect(engine2).not.toBeNull();
    engine2!.from(new BufferSource(csv), simpleCsvParser());

    const result2 = await engine2!.processChunk(async () => {
      await Promise.resolve();
    });

    expect(result2.done).toBe(true);
    expect(result2.totalProcessed).toBe(25);
  });

  it('should emit chunk:completed event', async () => {
    const csv = generateCsv(15);
    const engine = new BatchEngine(createConfig({ batchSize: 5 }));
    engine.from(new BufferSource(csv), simpleCsvParser());

    const chunkEvents: ChunkCompletedEvent[] = [];
    engine.on('chunk:completed', (e) => {
      chunkEvents.push(e);
    });

    await engine.processChunk(
      async () => {
        await Promise.resolve();
      },
      { maxRecords: 10 },
    );

    expect(chunkEvents).toHaveLength(1);
    expect(chunkEvents[0]?.processedRecords).toBe(10);
    expect(chunkEvents[0]?.done).toBe(false);
  });

  it('should emit job:completed when last chunk finishes', async () => {
    const csv = generateCsv(10);
    const engine = new BatchEngine(createConfig({ batchSize: 5 }));
    engine.from(new BufferSource(csv), simpleCsvParser());

    const events: string[] = [];
    engine.on('job:completed', () => events.push('job:completed'));
    engine.on('chunk:completed', () => events.push('chunk:completed'));

    const result = await engine.processChunk(async () => {
      await Promise.resolve();
    });

    expect(result.done).toBe(true);
    expect(events).toContain('job:completed');
    expect(events).toContain('chunk:completed');
  });

  it('should track cumulative totals across chunks', async () => {
    const csv = generateCsv(20);
    const stateStore = new InMemoryStateStore();
    const engine = new BatchEngine(createConfig({ stateStore, batchSize: 5 }));
    engine.from(new BufferSource(csv), simpleCsvParser());

    const result1 = await engine.processChunk(
      async () => {
        await Promise.resolve();
      },
      { maxRecords: 5 },
    );

    expect(result1.processedRecords).toBe(5);
    expect(result1.totalProcessed).toBe(5);

    // Second chunk on same instance
    engine.from(new BufferSource(csv), simpleCsvParser());
    const result2 = await engine.processChunk(
      async () => {
        await Promise.resolve();
      },
      { maxRecords: 5 },
    );

    expect(result2.processedRecords).toBe(5);
    expect(result2.totalProcessed).toBe(10);
  });

  it('should complete current batch before stopping (batch-level boundary)', async () => {
    const csv = generateCsv(20);
    const stateStore = new InMemoryStateStore();
    const engine = new BatchEngine(createConfig({ stateStore, batchSize: 10 }));
    engine.from(new BufferSource(csv), simpleCsvParser());

    // maxRecords=5 but batchSize=10 — the full batch of 10 completes
    const result = await engine.processChunk(
      async () => {
        await Promise.resolve();
      },
      { maxRecords: 5 },
    );

    // Should have processed all 10 in the first batch (batch boundary)
    expect(result.processedRecords).toBe(10);
    expect(result.done).toBe(false);
  });

  it('should work with continueOnError across chunks', async () => {
    const csv = generateCsv(20, true); // every 4th record invalid
    const stateStore = new InMemoryStateStore();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const engine = new BatchEngine(
      createConfig({
        stateStore,
        batchSize: 5,
        continueOnError: true,
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
      }),
    );
    engine.from(new BufferSource(csv), simpleCsvParser());

    const result1 = await engine.processChunk(
      async () => {
        await Promise.resolve();
      },
      { maxRecords: 5 },
    );

    expect(result1.done).toBe(false);
    expect(result1.processedRecords + result1.failedRecords).toBe(5);

    // Continue
    engine.from(new BufferSource(csv), simpleCsvParser());
    const result2 = await engine.processChunk(async () => {
      await Promise.resolve();
    });

    expect(result2.done).toBe(true);
    expect(result2.totalProcessed + result2.totalFailed).toBe(20);
  });
});
