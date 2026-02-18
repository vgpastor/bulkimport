import { describe, it, expect } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { JsonParser } from '../../src/infrastructure/parsers/JsonParser.js';
import { BufferSource } from '@batchactions/core';
import type { RawRecord } from '@batchactions/core';

function createImporter(options?: { batchSize?: number; continueOnError?: boolean }) {
  return new BulkImport({
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number', required: false },
      ],
    },
    batchSize: options?.batchSize ?? 10,
    continueOnError: options?.continueOnError ?? false,
  });
}

describe('JSON import acceptance', () => {
  it('should import a JSON array through the full pipeline', async () => {
    const json = JSON.stringify([
      { email: 'alice@test.com', name: 'Alice', age: 30 },
      { email: 'bob@test.com', name: 'Bob', age: 25 },
      { email: 'carol@test.com', name: 'Carol', age: 28 },
    ]);

    const importer = createImporter();
    importer.from(new BufferSource(json, { mimeType: 'application/json' }), new JsonParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(3);
    expect(processed[0]).toEqual(expect.objectContaining({ email: 'alice@test.com', name: 'Alice' }));

    const status = importer.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.totalRecords).toBe(3);
    expect(status.progress.percentage).toBe(100);
  });

  it('should import NDJSON through the full pipeline', async () => {
    const ndjson = [
      '{"email":"alice@test.com","name":"Alice","age":30}',
      '{"email":"bob@test.com","name":"Bob","age":25}',
    ].join('\n');

    const importer = createImporter();
    importer.from(new BufferSource(ndjson, { mimeType: 'application/x-ndjson' }), new JsonParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(2);
    const status = importer.getStatus();
    expect(status.status).toBe('COMPLETED');
  });

  it('should validate JSON records against schema', async () => {
    const json = JSON.stringify([
      { email: 'valid@test.com', name: 'Alice', age: 30 },
      { email: 'not-an-email', name: 'Bob', age: 25 },
      { email: 'also@valid.com', name: 'Carol', age: 28 },
    ]);

    const importer = createImporter({ continueOnError: true });
    importer.from(new BufferSource(json), new JsonParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(2);
    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    expect(failedRecords[0]?.raw.email).toBe('not-an-email');
  });

  it('should batch JSON records correctly', async () => {
    const records = Array.from({ length: 5 }, (_, i) => ({
      email: `user${String(i)}@test.com`,
      name: `User ${String(i)}`,
      age: 20 + i,
    }));

    const importer = createImporter({ batchSize: 2 });
    importer.from(new BufferSource(JSON.stringify(records)), new JsonParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const status = importer.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.batches).toHaveLength(3); // 2, 2, 1
    expect(status.progress.totalRecords).toBe(5);
    expect(status.progress.percentage).toBe(100);
  });

  it('should preview JSON records', async () => {
    const json = JSON.stringify([
      { email: 'alice@test.com', name: 'Alice', age: 30 },
      { email: 'invalid', name: 'Bob', age: 25 },
    ]);

    const importer = createImporter();
    importer.from(new BufferSource(json), new JsonParser());

    const preview = await importer.preview(10);

    expect(preview.validRecords).toHaveLength(1);
    expect(preview.invalidRecords).toHaveLength(1);
    expect(preview.columns).toContain('email');
    expect(preview.columns).toContain('name');
    expect(preview.columns).toContain('age');
  });
});
