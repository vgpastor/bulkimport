import { describe, it, expect, vi } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource } from '@batchactions/core';
import type { ParsedRecord, ProcessingContext } from '@batchactions/core';
import type { DuplicateChecker, DuplicateCheckResult } from '../../src/domain/ports/DuplicateChecker.js';

// --- Helpers ---

const schema = {
  fields: [
    { name: 'email', type: 'email' as const, required: true },
    { name: 'name', type: 'string' as const, required: true },
    { name: 'age', type: 'number' as const, required: false },
  ],
};

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

function createNoDupChecker(): DuplicateChecker {
  return {
    check: async (): Promise<DuplicateCheckResult> => {
      await Promise.resolve();
      return { isDuplicate: false };
    },
  };
}

// ============================================================
// DuplicateChecker — External duplicate detection
// ============================================================
describe('DuplicateChecker', () => {
  it('should mark record as failed when checker finds duplicate', async () => {
    const csv = generateCsv(3);

    const checker: DuplicateChecker = {
      check: async (fields: Record<string, unknown>): Promise<DuplicateCheckResult> => {
        await Promise.resolve();
        const email = fields['email'] as string;
        if (email === 'user2@test.com') {
          return { isDuplicate: true, existingId: 'db-id-42' };
        }
        return { isDuplicate: false };
      },
    };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      continueOnError: true,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(2);
    const status = importer.getStatus();
    expect(status.progress.processedRecords).toBe(2);
    expect(status.progress.failedRecords).toBe(1);
  });

  it('should pass through when no duplicate found', async () => {
    const csv = generateCsv(3);

    const checker = createNoDupChecker();

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(3);
    expect(importer.getStatus().status).toBe('COMPLETED');
  });

  it('should skip check for records that fail validation', async () => {
    const csv = generateCsv(3, true); // record 3 is invalid (not-an-email)

    const checkSpy = vi.fn(async (): Promise<DuplicateCheckResult> => {
      await Promise.resolve();
      return { isDuplicate: false };
    });

    const checker: DuplicateChecker = { check: checkSpy };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      continueOnError: true,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    // Only 2 valid records should trigger the checker (record 3 fails validation)
    expect(checkSpy).toHaveBeenCalledTimes(2);

    const status = importer.getStatus();
    expect(status.progress.processedRecords).toBe(2);
    expect(status.progress.failedRecords).toBe(1);
  });

  it('should include existingId in error message', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const checker: DuplicateChecker = {
      check: async (): Promise<DuplicateCheckResult> => {
        await Promise.resolve();
        return { isDuplicate: true, existingId: 'existing-123' };
      },
    };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      continueOnError: true,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    const errors = failedRecords[0]?.errors ?? [];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('existing-123');
    expect(errors[0]?.code).toBe('EXTERNAL_DUPLICATE');
  });

  it('should work with continueOnError', async () => {
    const csv = generateCsv(5);

    const checker: DuplicateChecker = {
      check: async (fields: Record<string, unknown>): Promise<DuplicateCheckResult> => {
        await Promise.resolve();
        const email = fields['email'] as string;
        // Mark records 2 and 4 as duplicates
        if (email === 'user2@test.com' || email === 'user4@test.com') {
          return { isDuplicate: true, existingId: 'dup' };
        }
        return { isDuplicate: false };
      },
    };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      continueOnError: true,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(3);
    const status = importer.getStatus();
    expect(status.progress.processedRecords).toBe(3);
    expect(status.progress.failedRecords).toBe(2);
    expect(status.status).toBe('COMPLETED');
  });

  it('should not call checker when not configured', async () => {
    const csv = generateCsv(3);

    const importer = new BulkImport({
      schema,
      batchSize: 10,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // All records should pass — no duplicate checking
    expect(processed).toHaveLength(3);
    expect(importer.getStatus().status).toBe('COMPLETED');
  });

  it('should handle checker errors gracefully by marking record as failed', async () => {
    const csv = generateCsv(3);

    const checker: DuplicateChecker = {
      check: async (fields: Record<string, unknown>): Promise<DuplicateCheckResult> => {
        await Promise.resolve();
        const email = fields['email'] as string;
        if (email === 'user2@test.com') {
          throw new Error('Database connection lost');
        }
        return { isDuplicate: false };
      },
    };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      continueOnError: true,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // record 2 should fail due to checker error, others pass
    expect(processed).toHaveLength(2);
    const status = importer.getStatus();
    expect(status.progress.processedRecords).toBe(2);
    expect(status.progress.failedRecords).toBe(1);

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    const errors = failedRecords[0]?.errors ?? [];
    expect(errors[0]?.message).toContain('Database connection lost');
  });

  it('should include metadata in DuplicateCheckResult', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const checker: DuplicateChecker = {
      check: async (): Promise<DuplicateCheckResult> => {
        await Promise.resolve();
        return {
          isDuplicate: true,
          existingId: 'existing-456',
          metadata: { matchedOn: 'email', confidence: 0.99 },
        };
      },
    };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      continueOnError: true,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    expect(failedRecords[0]?.errors[0]?.code).toBe('EXTERNAL_DUPLICATE');
  });

  it('should pass ProcessingContext to checker', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    let capturedContext: ProcessingContext | null = null;
    const checker: DuplicateChecker = {
      check: async (_fields: Record<string, unknown>, context: ProcessingContext): Promise<DuplicateCheckResult> => {
        await Promise.resolve();
        capturedContext = context;
        return { isDuplicate: false };
      },
    };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    expect(capturedContext).not.toBeNull();
    const ctx = capturedContext!;
    expect(ctx.jobId).toBeTruthy();
    expect(ctx.batchId).toBeTruthy();
    expect(ctx.batchIndex).toBe(0);
    expect(ctx.recordIndex).toBe(0);
  });

  it('should emit record:failed event with EXTERNAL_DUPLICATE error', async () => {
    const csv = ['email,name,age', 'user1@test.com,User 1,10'].join('\n');

    const checker: DuplicateChecker = {
      check: async (): Promise<DuplicateCheckResult> => {
        await Promise.resolve();
        return { isDuplicate: true, existingId: 'dup-1' };
      },
    };

    const importer = new BulkImport({
      schema,
      batchSize: 10,
      continueOnError: true,
      duplicateChecker: checker,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const failedEvents: string[] = [];
    importer.on('record:failed', (event) => {
      failedEvents.push(event.error);
    });

    await importer.start(async () => {
      await Promise.resolve();
    });

    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toContain('Duplicate record found');
    expect(failedEvents[0]).toContain('dup-1');
  });
});
