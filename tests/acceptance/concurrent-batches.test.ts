import { describe, it, expect } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import type { RawRecord } from '../../src/domain/model/Record.js';
import type { BatchCompletedEvent } from '../../src/domain/events/DomainEvents.js';

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
    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      maxConcurrentBatches: 1,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(30);
    const status = importer.getStatus();
    expect(status.state).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(30);
    expect(status.batches).toHaveLength(3);
  });

  it('should process all records correctly with maxConcurrentBatches=3', async () => {
    const csv = generateCsv(50);
    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      maxConcurrentBatches: 3,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      // Add small delay to simulate async work
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(processed).toHaveLength(50);
    const status = importer.getStatus();
    expect(status.state).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(50);
    expect(status.batches).toHaveLength(5);
  });

  it('should handle validation errors with concurrent batches', async () => {
    const csv = [
      'email,name,age',
      'user1@test.com,User 1,10',
      'not-an-email,User 2,20',
      'user3@test.com,User 3,30',
      'also-not-email,User 4,40',
      'user5@test.com,User 5,50',
      'user6@test.com,User 6,60',
    ].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 2,
      maxConcurrentBatches: 2,
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(processed).toHaveLength(4); // 6 total - 2 invalid
    expect(importer.getFailedRecords()).toHaveLength(2);
    expect(importer.getStatus().state).toBe('COMPLETED');
  });

  it('should emit batch events for all concurrent batches', async () => {
    const csv = generateCsv(20);
    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 5,
      maxConcurrentBatches: 4,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const batchCompleted: BatchCompletedEvent[] = [];
    importer.on('batch:completed', (e) => batchCompleted.push(e));

    await importer.start(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(batchCompleted).toHaveLength(4); // 20 records / 5 per batch
    const totalProcessed = batchCompleted.reduce((sum, e) => sum + e.processedCount, 0);
    expect(totalProcessed).toBe(20);
  });

  it('should handle processor errors in concurrent batches with continueOnError', async () => {
    const csv = generateCsv(20);
    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 5,
      maxConcurrentBatches: 2,
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    let callCount = 0;
    await importer.start(async () => {
      callCount++;
      if (callCount === 7) {
        throw new Error('Simulated processor error');
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    const status = importer.getStatus();
    expect(status.state).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(19);
    expect(status.progress.failedRecords).toBe(1);
  });
});
