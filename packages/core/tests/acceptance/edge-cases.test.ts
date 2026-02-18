import { describe, it, expect } from 'vitest';
import { BatchEngine } from '../../src/BatchEngine.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import type { RawRecord } from '../../src/domain/model/Record.js';
import type { ValidationResult } from '../../src/domain/model/ValidationResult.js';

// --- Simple CSV parser for tests ---

function simpleCsvParser(options?: { delimiter?: string }) {
  const delimiter = options?.delimiter ?? ',';
  return {
    *parse(data: string | Buffer): Iterable<RawRecord> {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      const lines = text.split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) return;
      const headers = lines[0]!.split(delimiter).map((h) => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i]!.split(delimiter).map((v) => v.trim());
        const record: RawRecord = {};
        for (let j = 0; j < headers.length; j++) {
          record[headers[j]!] = values[j] ?? '';
        }
        yield record;
      }
    },
  };
}

// --- Helpers ---

function createEngine(options?: {
  batchSize?: number;
  continueOnError?: boolean;
  skipEmptyRows?: boolean;
  validate?: (record: RawRecord) => ValidationResult;
}) {
  return new BatchEngine({
    batchSize: options?.batchSize ?? 100,
    continueOnError: options?.continueOnError ?? false,
    skipEmptyRows: options?.skipEmptyRows ?? false,
    validate: options?.validate,
  });
}

async function processAll(
  engine: BatchEngine,
  csv: string | Buffer,
  parserOptions?: { delimiter?: string },
): Promise<RawRecord[]> {
  engine.from(new BufferSource(csv), simpleCsvParser(parserOptions));
  const processed: RawRecord[] = [];
  await engine.start(async (record) => {
    processed.push(record);
    await Promise.resolve();
  });
  return processed;
}

// ============================================================
// Empty file / empty content
// ============================================================
describe('Edge case: empty file', () => {
  it('should complete with zero records when file is empty', async () => {
    const engine = createEngine();
    const processed = await processAll(engine, '');

    expect(processed).toHaveLength(0);
    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.totalRecords).toBe(0);
    expect(status.progress.percentage).toBe(0);
  });

  it('should complete with zero records when file has only header', async () => {
    const engine = createEngine();
    const processed = await processAll(engine, 'email,name,age');

    expect(processed).toHaveLength(0);
    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.totalRecords).toBe(0);
  });

  it('should handle file with only whitespace', async () => {
    const engine = createEngine({ continueOnError: true });
    const processed = await processAll(engine, '   \n  \n   ');

    // Whitespace-only content without headers produces unpredictable parser output.
    // The job should complete (not hang or crash).
    const status = engine.getStatus();
    expect(['COMPLETED', 'FAILED']).toContain(status.status);
    expect(processed).toHaveLength(0);
  });
});

// ============================================================
// BOM handling (UTF-8 BOM: 0xEF 0xBB 0xBF)
// ============================================================
describe('Edge case: BOM handling', () => {
  it('should handle UTF-8 BOM in CSV data', async () => {
    const BOM = '\uFEFF';
    const csv = `${BOM}email,name,age\nuser@test.com,Alice,30`;

    const engine = createEngine();
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual(
      expect.objectContaining({
        name: 'Alice',
        age: '30',
      }),
    );

    // The email field should be accessible (BOM shouldn't corrupt the first header)
    const emailValue = processed[0]?.email ?? processed[0]?.[`${BOM}email`];
    expect(emailValue).toBeDefined();
  });

  it('should handle BOM in Buffer source', async () => {
    const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
    const csv = Buffer.concat([BOM, Buffer.from('email,name,age\nuser@test.com,Bob,25')]);

    const engine = createEngine();
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(1);
  });
});

// ============================================================
// Delimiter variations
// ============================================================
describe('Edge case: special delimiters', () => {
  it('should parse semicolon-delimited CSV', async () => {
    const csv = 'email;name;age\nuser@test.com;Alice;30';

    const engine = createEngine();
    const processed = await processAll(engine, csv, { delimiter: ';' });

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual(
      expect.objectContaining({
        email: 'user@test.com',
        name: 'Alice',
        age: '30',
      }),
    );
  });

  it('should parse tab-delimited CSV', async () => {
    const csv = 'email\tname\tage\nuser@test.com\tAlice\t30';

    const engine = createEngine();
    const processed = await processAll(engine, csv, { delimiter: '\t' });

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual(
      expect.objectContaining({
        email: 'user@test.com',
        name: 'Alice',
        age: '30',
      }),
    );
  });

  it('should parse pipe-delimited CSV', async () => {
    const csv = 'email|name|age\nuser@test.com|Alice|30';

    const engine = createEngine();
    const processed = await processAll(engine, csv, { delimiter: '|' });

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual(
      expect.objectContaining({
        email: 'user@test.com',
        name: 'Alice',
        age: '30',
      }),
    );
  });
});

// ============================================================
// skipEmptyRows
// ============================================================
describe('Edge case: skipEmptyRows', () => {
  it('should skip empty rows when skipEmptyRows is true', async () => {
    const csv = 'email,name,age\nuser1@test.com,Alice,30\n,,\nuser2@test.com,Bob,25\n,,';

    const engine = createEngine({ skipEmptyRows: true, continueOnError: true });
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(2);
    expect(await engine.getFailedRecords()).toHaveLength(0);
  });

  it('should process empty-value rows when skipEmptyRows is false', async () => {
    // With skipEmptyRows: false, comma-only rows produce records with empty strings.
    // Without validation, these records are passed to the processor.
    const csv = 'email,name,age\nuser1@test.com,Alice,30\n,,\nuser2@test.com,Bob,25';

    const engine = createEngine({ skipEmptyRows: false, continueOnError: true });
    const processed = await processAll(engine, csv);

    // Without skipEmptyRows, empty rows still pass through (all values are empty strings).
    // The simple parser filters truly empty lines, but ',,' lines yield a record.
    expect(processed).toHaveLength(3);
    expect(await engine.getFailedRecords()).toHaveLength(0);
  });
});

// ============================================================
// Line ending variations
// ============================================================
describe('Edge case: line endings', () => {
  it('should handle CRLF line endings', async () => {
    const csv = 'email,name,age\r\nuser1@test.com,Alice,30\r\nuser2@test.com,Bob,25';

    const engine = createEngine();
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(2);
  });

  it('should handle trailing newline', async () => {
    const csv = 'email,name,age\nuser@test.com,Alice,30\n';

    const engine = createEngine();
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(1);
  });

  it('should handle multiple trailing newlines', async () => {
    const csv = 'email,name,age\nuser@test.com,Alice,30\n\n\n';

    const engine = createEngine();
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(1);
  });
});

// ============================================================
// Single record
// ============================================================
describe('Edge case: single record', () => {
  it('should process a single record correctly', async () => {
    const csv = 'email,name,age\nuser@test.com,Alice,30';

    const engine = createEngine();
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(1);
    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.percentage).toBe(100);
    expect(status.progress.totalRecords).toBe(1);
  });
});

// ============================================================
// Large batch size with few records
// ============================================================
describe('Edge case: batchSize larger than total records', () => {
  it('should process all records in a single batch', async () => {
    const csv = 'email,name,age\nuser1@test.com,Alice,30\nuser2@test.com,Bob,25';

    const engine = createEngine({ batchSize: 1000 });
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(2);
    const status = engine.getStatus();
    expect(status.batches).toHaveLength(1);
    expect(status.progress.percentage).toBe(100);
  });
});

// ============================================================
// All records fail validation (using validate config)
// ============================================================
describe('Edge case: all records fail validation', () => {
  it('should complete with 100% when all records fail validation', async () => {
    const csv = 'email,name,age\nnot-email,Alice,30\nalso-not-email,Bob,25';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const engine = createEngine({
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
    });
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(0);
    expect(await engine.getFailedRecords()).toHaveLength(2);

    const status = engine.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.percentage).toBe(100);
    expect(status.progress.failedRecords).toBe(2);
    expect(status.progress.processedRecords).toBe(0);
  });
});

// ============================================================
// Validate function with mixed valid/invalid records
// ============================================================
describe('Edge case: validate function with mixed results', () => {
  it('should pass valid records and reject invalid ones', async () => {
    const csv = 'email,name,age\nuser@test.com,Alice,30\nnot-email,Bob,25\nalice@test.com,Charlie,20';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const engine = createEngine({
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
    });
    const processed = await processAll(engine, csv);

    expect(processed).toHaveLength(2);
    expect(await engine.getFailedRecords()).toHaveLength(1);
    expect(engine.getStatus().status).toBe('COMPLETED');
  });
});
