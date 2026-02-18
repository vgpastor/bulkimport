import { describe, it, expect } from 'vitest';
import { BatchEngine } from '../../src/BatchEngine.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import type { RawRecord } from '../../src/domain/model/Record.js';
import type { BatchCompletedEvent } from '../../src/domain/events/DomainEvents.js';

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

describe('maxConcurrentBatches', () => {
  it('should process all records correctly with maxConcurrentBatches=1 (default sequential)', async () => {
    const csv = generateCsv(30);
    const engine = new BatchEngine({
      batchSize: 10,
      maxConcurrentBatches: 1,
    });

    engine.from(new BufferSource(csv), simpleCsvParser());

    const processed: RawRecord[] = [];
    await engine.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(30);
    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(30);
    expect(status.batches).toHaveLength(3);
  });

  it('should process all records correctly with maxConcurrentBatches=3', async () => {
    const csv = generateCsv(50);
    const engine = new BatchEngine({
      batchSize: 10,
      maxConcurrentBatches: 3,
    });

    engine.from(new BufferSource(csv), simpleCsvParser());

    const processed: RawRecord[] = [];
    await engine.start(async (record) => {
      processed.push(record);
      // Add small delay to simulate async work
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(processed).toHaveLength(50);
    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(50);
    expect(status.batches).toHaveLength(5);
  });

  it('should handle processor errors with concurrent batches and continueOnError', async () => {
    const csv = generateCsv(20);
    const engine = new BatchEngine({
      batchSize: 5,
      maxConcurrentBatches: 2,
      continueOnError: true,
    });

    engine.from(new BufferSource(csv), simpleCsvParser());

    let callCount = 0;
    await engine.start(async () => {
      callCount++;
      if (callCount === 7) {
        throw new Error('Simulated processor error');
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(19);
    expect(status.progress.failedRecords).toBe(1);
  });

  it('should emit batch events for all concurrent batches', async () => {
    const csv = generateCsv(20);
    const engine = new BatchEngine({
      batchSize: 5,
      maxConcurrentBatches: 4,
    });

    engine.from(new BufferSource(csv), simpleCsvParser());

    const batchCompleted: BatchCompletedEvent[] = [];
    engine.on('batch:completed', (e) => batchCompleted.push(e));

    await engine.start(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(batchCompleted).toHaveLength(4); // 20 records / 5 per batch
    const totalProcessed = batchCompleted.reduce((sum, e) => sum + e.processedCount, 0);
    expect(totalProcessed).toBe(20);
  });

  it('should handle processor errors in concurrent batches with continueOnError', async () => {
    const csv = generateCsv(20);
    const engine = new BatchEngine({
      batchSize: 5,
      maxConcurrentBatches: 2,
      continueOnError: true,
    });

    engine.from(new BufferSource(csv), simpleCsvParser());

    let callCount = 0;
    await engine.start(async () => {
      callCount++;
      if (callCount === 7) {
        throw new Error('Simulated processor error');
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(19);
    expect(status.progress.failedRecords).toBe(1);
  });
});
