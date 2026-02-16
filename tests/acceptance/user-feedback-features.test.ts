import { describe, it, expect, vi } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import type { DomainEvent } from '../../src/domain/events/DomainEvents.js';
import type { ParsedRecord } from '../../src/domain/model/Record.js';

// ============================================================
// #1 — import:started fires asynchronously
// ============================================================
describe('import:started deferred emission', () => {
  it('should allow handlers registered after start() on the same tick to receive import:started', async () => {
    const csv = 'email,name\nuser@test.com,Alice';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const handler = vi.fn();

    // Start the import — do NOT await yet
    const promise = importer.start(async () => {
      await Promise.resolve();
    });

    // Register handler AFTER start() but on the same tick
    importer.on('import:started', handler);

    await promise;

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'import:started' }));
  });

  it('should still deliver import:started to handlers registered before start()', async () => {
    const csv = 'email,name\nuser@test.com,Alice';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const handler = vi.fn();
    importer.on('import:started', handler);

    await importer.start(async () => {
      await Promise.resolve();
    });

    expect(handler).toHaveBeenCalledOnce();
  });
});

// ============================================================
// #2 — generateTemplate() with example rows
// ============================================================
describe('generateTemplate with example rows', () => {
  it('should generate header only when no options provided', () => {
    const template = BulkImport.generateTemplate({
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'string', required: true },
      ],
    });

    expect(template).toBe('email,name');
  });

  it('should generate header only when exampleRows is 0', () => {
    const template = BulkImport.generateTemplate(
      {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
      { exampleRows: 0 },
    );

    expect(template).toBe('email,name');
  });

  it('should generate header with synthetic example rows', () => {
    const template = BulkImport.generateTemplate(
      {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
          { name: 'active', type: 'boolean', required: false },
          { name: 'joinDate', type: 'date', required: false },
        ],
      },
      { exampleRows: 2 },
    );

    const lines = template.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('email,name,age,active,joinDate');
    expect(lines[1]).toBe('user1@example.com,name_1,100,false,2024-01-01');
    expect(lines[2]).toBe('user2@example.com,name_2,200,true,2024-01-02');
  });

  it('should use defaultValue when defined for a field', () => {
    const template = BulkImport.generateTemplate(
      {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'role', type: 'string', required: false, defaultValue: 'user' },
        ],
      },
      { exampleRows: 1 },
    );

    const lines = template.split('\n');
    expect(lines[1]).toBe('user1@example.com,user');
  });

  it('should generate array example values with separator', () => {
    const template = BulkImport.generateTemplate(
      {
        fields: [
          { name: 'tags', type: 'array', required: false },
          { name: 'zones', type: 'array', required: false, separator: ';' },
        ],
      },
      { exampleRows: 1 },
    );

    const lines = template.split('\n');
    expect(lines[1]).toBe('value1a,value1b,value1a;value1b');
  });

  it('should generate custom type example values', () => {
    const template = BulkImport.generateTemplate(
      {
        fields: [{ name: 'nif', type: 'custom', required: true }],
      },
      { exampleRows: 1 },
    );

    const lines = template.split('\n');
    expect(lines[1]).toBe('nif_1');
  });
});

// ============================================================
// #3 — onAny() wildcard for events
// ============================================================
describe('onAny wildcard event subscription', () => {
  it('should receive all events via onAny()', async () => {
    const csv = 'email,name\nuser@test.com,Alice';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const allEvents: DomainEvent[] = [];
    importer.onAny((event) => {
      allEvents.push(event);
    });

    await importer.start(async () => {
      await Promise.resolve();
    });

    const eventTypes = allEvents.map((e) => e.type);
    expect(eventTypes).toContain('import:started');
    expect(eventTypes).toContain('batch:started');
    expect(eventTypes).toContain('record:processed');
    expect(eventTypes).toContain('batch:completed');
    expect(eventTypes).toContain('import:progress');
    expect(eventTypes).toContain('import:completed');
  });

  it('should support offAny() to unsubscribe wildcard handler', async () => {
    const csv = 'email,name\nuser@test.com,Alice';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const handler = vi.fn();
    importer.onAny(handler);
    importer.offAny(handler);

    await importer.start(async () => {
      await Promise.resolve();
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should receive both onAny and specific on() events without duplication', async () => {
    const csv = 'email,name\nuser@test.com,Alice';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const specificHandler = vi.fn();
    const wildcardHandler = vi.fn();

    importer.on('import:started', specificHandler);
    importer.onAny(wildcardHandler);

    await importer.start(async () => {
      await Promise.resolve();
    });

    expect(specificHandler).toHaveBeenCalledOnce();
    // Wildcard receives ALL events, including import:started
    expect(wildcardHandler.mock.calls.length).toBeGreaterThan(1);
    expect(wildcardHandler).toHaveBeenCalledWith(expect.objectContaining({ type: 'import:started' }));
  });
});

// ============================================================
// #4 — ParsedRecord type in processor callback
// ============================================================
describe('ParsedRecord type in processor callback', () => {
  it('should receive transformed data with correct type in processor', async () => {
    const csv = 'email,name,zones\nuser@test.com,Alice,"zone1,zone2"';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'zones', type: 'array', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record: ParsedRecord) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    // zones arrives as string[] — transforms already applied
    expect(processed[0]?.zones).toEqual(['zone1', 'zone2']);
  });
});

// ============================================================
// #5 — count() for totalRecords before start()
// ============================================================
describe('count() method', () => {
  it('should return total record count without modifying state', async () => {
    const csv = 'email,name\nuser1@test.com,Alice\nuser2@test.com,Bob\nuser3@test.com,Charlie';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const total = await importer.count();
    expect(total).toBe(3);

    // Status should still be CREATED — count() doesn't modify state
    expect(importer.getStatus().status).toBe('CREATED');
  });

  it('should throw if source is not configured', async () => {
    const importer = new BulkImport({
      schema: {
        fields: [{ name: 'email', type: 'email', required: true }],
      },
    });

    await expect(importer.count()).rejects.toThrow('Source and parser must be configured');
  });

  it('should return 0 for empty file', async () => {
    const csv = 'email,name\n';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const total = await importer.count();
    expect(total).toBe(0);
  });
});

// ============================================================
// #6 — getStatus() returns both status and state (deprecated)
// ============================================================
describe('getStatus() returns status and state', () => {
  it('should return both status and state with same value', () => {
    const importer = new BulkImport({
      schema: {
        fields: [{ name: 'email', type: 'email', required: true }],
      },
    });

    const result = importer.getStatus();
    expect(result.status).toBe('CREATED');
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(result.state).toBe('CREATED');
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(result.status).toBe(result.state);
  });

  it('should have matching status and state after processing', async () => {
    const csv = 'email\nuser@test.com';

    const importer = new BulkImport({
      schema: {
        fields: [{ name: 'email', type: 'email', required: true }],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const result = importer.getStatus();
    expect(result.status).toBe('COMPLETED');
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(result.state).toBe('COMPLETED');
  });
});

// ============================================================
// #7 — itemTransform for array fields
// ============================================================
describe('itemTransform for array fields', () => {
  it('should apply itemTransform to each element after splitting', async () => {
    const csv = 'email,zones\nuser@test.com," Zone-A ; Zone-B ; Zone-C "';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          {
            name: 'zones',
            type: 'array',
            required: true,
            separator: ';',
            itemTransform: (s: string) => s.toLowerCase(),
          },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]?.zones).toEqual(['zone-a', 'zone-b', 'zone-c']);
  });

  it('should work without itemTransform (backward compatible)', async () => {
    const csv = 'email,zones\nuser@test.com," Zone-A , Zone-B "';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'zones', type: 'array', required: true },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    // Without itemTransform, items are only trimmed (existing behavior)
    expect(processed[0]?.zones).toEqual(['Zone-A', 'Zone-B']);
  });

  it('should apply itemTransform with trim for dirty data', async () => {
    const csv = 'email,tags\nuser@test.com," admin , Editor , USER "';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          {
            name: 'tags',
            type: 'array',
            required: true,
            itemTransform: (s: string) => s.toLowerCase(),
          },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]?.tags).toEqual(['admin', 'editor', 'user']);
  });
});
