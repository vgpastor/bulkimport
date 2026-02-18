import { describe, it, expect } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '@batchactions/core';
import type { RawRecord } from '@batchactions/core';

// ============================================================
// Array field type
// ============================================================
describe('Schema advanced: array fields', () => {
  it('should split comma-separated string into array', async () => {
    const csv = 'email,name,zones\nuser@test.com,Alice,"zone1,zone2,zone3"';

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

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]?.zones).toEqual(['zone1', 'zone2', 'zone3']);
  });

  it('should use custom separator for array field', async () => {
    const csv = 'email,name,tags\nuser@test.com,Alice,tag1;tag2;tag3';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'tags', type: 'array', required: true, separator: ';' },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]?.tags).toEqual(['tag1', 'tag2', 'tag3']);
  });

  it('should trim whitespace in array items', async () => {
    const csv = 'email,name,roles\nuser@test.com,Alice," admin , editor , viewer "';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'roles', type: 'array', required: false },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed[0]?.roles).toEqual(['admin', 'editor', 'viewer']);
  });

  it('should handle empty array field as required', async () => {
    const csv = 'email,name,zones\nuser@test.com,Alice,';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'zones', type: 'array', required: true },
        ],
      },
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());
    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    expect(failedRecords[0]?.errors[0]?.code).toBe('REQUIRED');
  });
});

// ============================================================
// Column aliases
// ============================================================
describe('Schema advanced: column aliases', () => {
  it('should resolve aliased column names to canonical names', async () => {
    const csv = 'Correo electrónico,Nombre,Edad\nuser@test.com,Alice,30';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true, aliases: ['Correo electrónico', 'correo', 'mail'] },
          { name: 'name', type: 'string', required: true, aliases: ['Nombre', 'nombre_completo'] },
          { name: 'age', type: 'number', required: false, aliases: ['Edad'] },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual(
      expect.objectContaining({
        email: 'user@test.com',
        name: 'Alice',
        age: '30',
      }),
    );
  });

  it('should be case-insensitive for aliases', async () => {
    const csv = 'EMAIL,NAME,AGE\nuser@test.com,Alice,30';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual(expect.objectContaining({ email: 'user@test.com', name: 'Alice' }));
  });

  it('should resolve aliases in preview', async () => {
    const csv = 'Documento,Nombre\n12345678Z,Alice';

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'documentNumber', type: 'string', required: true, aliases: ['Documento', 'DNI'] },
          { name: 'name', type: 'string', required: true, aliases: ['Nombre'] },
        ],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());
    const preview = await importer.preview(10);

    expect(preview.validRecords).toHaveLength(1);
    expect(preview.columns).toContain('documentNumber');
    expect(preview.columns).toContain('name');
    expect(preview.validRecords[0]?.parsed.documentNumber).toBe('12345678Z');
  });
});

// ============================================================
// Unique fields (duplicate detection)
// ============================================================
describe('Schema advanced: unique fields', () => {
  it('should detect duplicate values in unique fields', async () => {
    const csv = [
      'email,name,identifier',
      'alice@test.com,Alice,ID001',
      'bob@test.com,Bob,ID002',
      'carol@test.com,Carol,ID001', // duplicate
    ].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'identifier', type: 'string', required: true },
        ],
        uniqueFields: ['identifier'],
      },
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(2);
    const failedDups = await importer.getFailedRecords();
    expect(failedDups).toHaveLength(1);
    expect(failedDups[0]?.errors[0]?.code).toBe('DUPLICATE_VALUE');
  });

  it('should detect duplicates case-insensitively', async () => {
    const csv = [
      'email,name,identifier',
      'alice@test.com,Alice,abc',
      'bob@test.com,Bob,ABC', // case-insensitive duplicate
    ].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'identifier', type: 'string', required: true },
        ],
        uniqueFields: ['identifier'],
      },
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(await importer.getFailedRecords()).toHaveLength(1);
  });

  it('should track uniqueness across batches', async () => {
    const csv = [
      'email,name,identifier',
      'alice@test.com,Alice,ID001',
      'bob@test.com,Bob,ID002',
      'carol@test.com,Carol,ID001', // duplicate from batch 1
    ].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'identifier', type: 'string', required: true },
        ],
        uniqueFields: ['identifier'],
      },
      batchSize: 2,
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Record 3 (Carol/ID001) should be rejected even though it's in batch 2
    expect(processed).toHaveLength(2);
    expect(await importer.getFailedRecords()).toHaveLength(1);
  });

  it('should support multiple unique fields', async () => {
    const csv = [
      'email,name,identifier',
      'alice@test.com,Alice,ID001',
      'alice@test.com,Bob,ID002', // duplicate email
      'carol@test.com,Carol,ID001', // duplicate identifier
    ].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'identifier', type: 'string', required: true },
        ],
        uniqueFields: ['email', 'identifier'],
      },
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(await importer.getFailedRecords()).toHaveLength(2);
  });

  it('should skip uniqueness check for empty values', async () => {
    const csv = ['email,name,identifier', 'alice@test.com,Alice,', 'bob@test.com,Bob,'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'identifier', type: 'string', required: false },
        ],
        uniqueFields: ['identifier'],
      },
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Both records should pass — empty values don't trigger uniqueness check
    expect(processed).toHaveLength(2);
  });
});

// ============================================================
// All features combined
// ============================================================
describe('Schema advanced: combined features', () => {
  it('should resolve aliases, split arrays, and detect duplicates in one import', async () => {
    const csv = [
      'Correo,Nombre,Documento,Zonas',
      'alice@test.com,Alice,ID001,"zone1;zone2"',
      'bob@test.com,Bob,ID002,"zone3;zone4"',
      'carol@test.com,Carol,ID001,"zone5"', // duplicate documentNumber
    ].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true, aliases: ['Correo'] },
          { name: 'name', type: 'string', required: true, aliases: ['Nombre'] },
          { name: 'documentNumber', type: 'string', required: true, aliases: ['Documento'] },
          { name: 'zones', type: 'array', required: false, aliases: ['Zonas'], separator: ';' },
        ],
        uniqueFields: ['documentNumber'],
      },
      continueOnError: true,
    });

    importer.from(new BufferSource(csv), new CsvParser());

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(2);
    expect(processed[0]?.zones).toEqual(['zone1', 'zone2']);
    expect(processed[0]?.email).toBe('alice@test.com');
    expect(processed[0]?.documentNumber).toBe('ID001');

    const failedCombined = await importer.getFailedRecords();
    expect(failedCombined).toHaveLength(1);
    expect(failedCombined[0]?.errors[0]?.code).toBe('DUPLICATE_VALUE');
  });
});

// ============================================================
// Generate template
// ============================================================
describe('Schema advanced: generateTemplate', () => {
  it('should generate a CSV header from schema fields', () => {
    const template = BulkImport.generateTemplate({
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number', required: false },
      ],
    });

    expect(template).toBe('email,name,age');
  });

  it('should use canonical names regardless of aliases', () => {
    const template = BulkImport.generateTemplate({
      fields: [
        { name: 'email', type: 'email', required: true, aliases: ['correo', 'mail'] },
        { name: 'documentNumber', type: 'string', required: true, aliases: ['DNI', 'Documento'] },
      ],
    });

    expect(template).toBe('email,documentNumber');
  });

  it('should handle single field', () => {
    const template = BulkImport.generateTemplate({
      fields: [{ name: 'id', type: 'string', required: true }],
    });

    expect(template).toBe('id');
  });
});
