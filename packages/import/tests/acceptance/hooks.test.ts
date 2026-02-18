import { describe, it, expect, vi } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '@batchactions/core';
import type { RawRecord, ParsedRecord, ProcessedRecord, JobHooks, HookContext } from '@batchactions/core';

// --- Helpers ---

function generateCsv(count: number, includeInvalid = false): string {
  const header = 'email,name,age';
  const rows: string[] = [];
  for (let i = 1; i <= count; i++) {
    if (includeInvalid && i % 3 === 0) {
      rows.push(`not-an-email,User ${String(i)},${String(i * 10)}`);
    } else {
      rows.push(`user${String(i)}@test.com,User ${String(i)},${String(i * 10)}`);
    }
  }
  return [header, ...rows].join('\n');
}

// ============================================================
// Hooks — Lifecycle hooks for record processing pipeline
// ============================================================
describe('Hooks', () => {
  it('should call beforeValidate hook and use modified raw record for validation', async () => {
    const csv = ['email,name,age', 'USER1@TEST.COM,User 1,10'].join('\n');

    const hooks: JobHooks = {
      beforeValidate: async (record: RawRecord) => {
        await Promise.resolve();
        // Modify email to lowercase
        return {
          ...record,
          email: typeof record['email'] === 'string' ? record['email'].toLowerCase() : record['email'],
        };
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    // The email should have been lowercased by the hook before validation/transforms
    const status = importer.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(1);
  });

  it('should call afterValidate hook and allow modifying processed record', async () => {
    // Record that would fail validation (not-an-email)
    const csv = ['email,name,age', 'not-an-email,User 1,10'].join('\n');

    const hooks: JobHooks = {
      afterValidate: async (record: ProcessedRecord) => {
        await Promise.resolve();
        // Clear errors — effectively overriding validation
        if (record.errors.length > 0) {
          return { ...record, errors: [], status: 'valid' as const };
        }
        return record;
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // The record should have been processed because afterValidate cleared errors
    expect(processed).toHaveLength(1);
  });

  it('should call beforeProcess hook and use modified parsed record', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const hooks: JobHooks = {
      beforeProcess: async (record: ParsedRecord) => {
        await Promise.resolve();
        // Enrich with extra field
        return { ...record, enriched: true };
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]?.['enriched']).toBe(true);
  });

  it('should call afterProcess hook after successful processing', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10', 'user2@test.com,User 2,20'].join('\n');

    const afterProcessSpy = vi.fn(async () => {
      await Promise.resolve();
    });

    const hooks: JobHooks = {
      afterProcess: afterProcessSpy,
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    expect(afterProcessSpy).toHaveBeenCalledTimes(2);
    // Each call receives a ProcessedRecord and HookContext
    const firstCall = afterProcessSpy.mock.calls[0] as unknown[];
    expect(firstCall[0]).toHaveProperty('status', 'processed');
    expect(firstCall[1]).toHaveProperty('jobId');
  });

  it('should not call process hooks for invalid records', async () => {
    const csv = ['email,name,age', 'not-an-email,User 1,10'].join('\n');

    const beforeProcessSpy = vi.fn(async (record: ParsedRecord) => {
      await Promise.resolve();
      return record;
    });
    const afterProcessSpy = vi.fn(async () => {
      await Promise.resolve();
    });

    const hooks: JobHooks = {
      beforeProcess: beforeProcessSpy,
      afterProcess: afterProcessSpy,
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    // Neither hook should be called for the invalid record
    expect(beforeProcessSpy).not.toHaveBeenCalled();
    expect(afterProcessSpy).not.toHaveBeenCalled();
  });

  it('should mark record as failed when beforeValidate hook throws', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const hooks: JobHooks = {
      beforeValidate: async () => {
        await Promise.resolve();
        throw new Error('beforeValidate boom');
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const status = importer.getStatus();
    expect(status.progress.failedRecords).toBe(1);
    expect(status.progress.processedRecords).toBe(0);
  });

  it('should mark record as failed when beforeProcess hook throws', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const hooks: JobHooks = {
      beforeProcess: async () => {
        await Promise.resolve();
        throw new Error('beforeProcess boom');
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const status = importer.getStatus();
    expect(status.progress.failedRecords).toBe(1);
    expect(status.progress.processedRecords).toBe(0);
  });

  it('should mark record as failed when afterProcess hook throws', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const hooks: JobHooks = {
      afterProcess: async () => {
        await Promise.resolve();
        throw new Error('afterProcess boom');
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const status = importer.getStatus();
    expect(status.progress.failedRecords).toBe(1);
    expect(status.progress.processedRecords).toBe(0);
  });

  it('should work without hooks configured (default behavior unchanged)', async () => {
    const csv = generateCsv(5);
    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(5);
    expect(importer.getStatus().status).toBe('COMPLETED');
  });

  it('should pass correct HookContext to all hooks', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const contexts: HookContext[] = [];

    const hooks: JobHooks = {
      beforeValidate: async (record: RawRecord, ctx: HookContext) => {
        await Promise.resolve();
        contexts.push(ctx);
        return record;
      },
      beforeProcess: async (record: ParsedRecord, ctx: HookContext) => {
        await Promise.resolve();
        contexts.push(ctx);
        return record;
      },
      afterProcess: async (_record: ProcessedRecord, ctx: HookContext) => {
        contexts.push(ctx);
        await Promise.resolve();
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    // 3 hooks called: beforeValidate, beforeProcess, afterProcess
    expect(contexts).toHaveLength(3);

    for (const ctx of contexts) {
      expect(ctx.jobId).toBeTruthy();
      expect(ctx.batchId).toBeTruthy();
      expect(ctx.batchIndex).toBe(0);
      expect(ctx.recordIndex).toBe(0);
      expect(ctx.totalRecords).toBeGreaterThan(0);
      expect(ctx.signal).toBeDefined();
    }
  });

  it('should work with hooks and continueOnError', async () => {
    const csv = generateCsv(6, true); // records 3 and 6 are invalid

    let hookCallCount = 0;
    const hooks: JobHooks = {
      beforeValidate: async (record: RawRecord) => {
        await Promise.resolve();
        hookCallCount++;
        return record;
      },
    };

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      hooks,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    // beforeValidate should be called for ALL records (valid + invalid)
    expect(hookCallCount).toBe(6);

    const status = importer.getStatus();
    expect(status.progress.processedRecords).toBe(4);
    expect(status.progress.failedRecords).toBe(2);
  });
});
