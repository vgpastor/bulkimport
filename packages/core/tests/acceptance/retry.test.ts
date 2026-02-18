import { describe, it, expect } from 'vitest';
import { BatchEngine } from '../../src/BatchEngine.js';
import { BufferSource } from '../../src/infrastructure/sources/BufferSource.js';
import { InMemoryStateStore } from '../../src/infrastructure/state/InMemoryStateStore.js';
import type { RawRecord } from '../../src/domain/model/Record.js';
import type { RecordRetriedEvent } from '../../src/domain/events/DomainEvents.js';

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

const csv = 'email,name\na@test.com,Alice\nb@test.com,Bob\nc@test.com,Charlie';

describe('Retry mechanism', () => {
  it('should succeed on first try when processor does not fail (maxRetries=3)', async () => {
    const engine = new BatchEngine({ batchSize: 10, maxRetries: 3, retryDelayMs: 0 });
    engine.from(new BufferSource(csv), simpleCsvParser());

    const processed: string[] = [];
    await engine.start(async (record) => {
      processed.push(record.email as string);
      await Promise.resolve();
    });

    expect(engine.getStatus().status).toBe('COMPLETED');
    expect(processed).toEqual(['a@test.com', 'b@test.com', 'c@test.com']);
  });

  it('should retry and succeed after transient failure', async () => {
    const engine = new BatchEngine({ batchSize: 10, maxRetries: 3, retryDelayMs: 0 });
    engine.from(new BufferSource(csv), simpleCsvParser());

    const attempts = new Map<string, number>();
    await engine.start(async (record) => {
      const email = record.email as string;
      const count = (attempts.get(email) ?? 0) + 1;
      attempts.set(email, count);

      // b@test.com fails twice then succeeds
      if (email === 'b@test.com' && count <= 2) {
        throw new Error('Transient DB error');
      }
      await Promise.resolve();
    });

    expect(engine.getStatus().status).toBe('COMPLETED');
    expect(attempts.get('b@test.com')).toBe(3);

    const failedRecords = await engine.getFailedRecords();
    expect(failedRecords).toHaveLength(0);
  });

  it('should fail after exhausting all retries', async () => {
    const engine = new BatchEngine({
      batchSize: 10,
      maxRetries: 2,
      retryDelayMs: 0,
      continueOnError: true,
    });
    engine.from(new BufferSource(csv), simpleCsvParser());

    await engine.start(async (record) => {
      if ((record.email as string) === 'b@test.com') {
        throw new Error('Persistent failure');
      }
      await Promise.resolve();
    });

    expect(engine.getStatus().status).toBe('COMPLETED');

    const failedRecords = await engine.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    expect(failedRecords[0]?.retryCount).toBe(2);
    expect(failedRecords[0]?.processingError).toBe('Persistent failure');
  });

  it('should emit record:retried events for each retry attempt', async () => {
    const engine = new BatchEngine({
      batchSize: 10,
      maxRetries: 3,
      retryDelayMs: 0,
      continueOnError: true,
    });
    engine.from(new BufferSource(csv), simpleCsvParser());

    const retryEvents: RecordRetriedEvent[] = [];
    engine.on('record:retried', (event) => {
      retryEvents.push(event);
    });

    let callCount = 0;
    await engine.start(async (record) => {
      if ((record.email as string) === 'a@test.com') {
        callCount++;
        if (callCount <= 2) {
          throw new Error(`Attempt ${String(callCount)} failed`);
        }
      }
      await Promise.resolve();
    });

    expect(retryEvents).toHaveLength(2);
    expect(retryEvents[0]?.attempt).toBe(1);
    expect(retryEvents[0]?.maxRetries).toBe(3);
    expect(retryEvents[0]?.error).toBe('Attempt 1 failed');
    expect(retryEvents[1]?.attempt).toBe(2);
    expect(retryEvents[1]?.error).toBe('Attempt 2 failed');
  });

  it('should not retry validation failures', async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const engine = new BatchEngine({
      batchSize: 10,
      maxRetries: 3,
      retryDelayMs: 0,
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

    const invalidCsv = 'email,name\nnot-an-email,Alice\nb@test.com,Bob';
    engine.from(new BufferSource(invalidCsv), simpleCsvParser());

    const retryEvents: RecordRetriedEvent[] = [];
    engine.on('record:retried', (event) => {
      retryEvents.push(event);
    });

    await engine.start(async () => {
      await Promise.resolve();
    });

    // Validation failures are never retried
    expect(retryEvents).toHaveLength(0);

    const failed = await engine.getFailedRecords();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.status).toBe('invalid');
  });

  it('should transition to FAILED when retries exhausted and continueOnError is false', async () => {
    const engine = new BatchEngine({
      batchSize: 10,
      maxRetries: 2,
      retryDelayMs: 0,
      continueOnError: false,
    });
    engine.from(new BufferSource(csv), simpleCsvParser());

    let failedError = '';
    engine.on('job:failed', (event) => {
      failedError = event.error;
    });

    await engine.start(async (record) => {
      if ((record.email as string) === 'a@test.com') {
        throw new Error('Always fails');
      }
      await Promise.resolve();
    });

    expect(engine.getStatus().status).toBe('FAILED');
    expect(failedError).toBe('Always fails');
  });

  it('should track retryCount in successfully processed records', async () => {
    const stateStore = new InMemoryStateStore();
    const engine = new BatchEngine({
      batchSize: 10,
      maxRetries: 3,
      retryDelayMs: 0,
      stateStore,
    });

    const singleCsv = 'email,name\na@test.com,Alice';
    engine.from(new BufferSource(singleCsv), simpleCsvParser());

    let callCount = 0;
    await engine.start(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('First attempt fails');
      }
      await Promise.resolve();
    });

    expect(engine.getStatus().status).toBe('COMPLETED');

    const processedRecords = await stateStore.getProcessedRecords(engine.getJobId());
    expect(processedRecords).toHaveLength(1);
    expect(processedRecords[0]?.retryCount).toBe(1);
  });

  it('should default to no retries when maxRetries is not configured', async () => {
    const engine = new BatchEngine({
      batchSize: 10,
      continueOnError: true,
    });
    engine.from(new BufferSource(csv), simpleCsvParser());

    const retryEvents: RecordRetriedEvent[] = [];
    engine.on('record:retried', (event) => {
      retryEvents.push(event);
    });

    await engine.start(async (record) => {
      if ((record.email as string) === 'b@test.com') {
        throw new Error('Fails immediately');
      }
      await Promise.resolve();
    });

    expect(retryEvents).toHaveLength(0);

    const failed = await engine.getFailedRecords();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.retryCount).toBe(0);
  });

  it('should work with concurrent batch processing', async () => {
    const sixRecords = 'email,name\na@t.com,A\nb@t.com,B\nc@t.com,C\nd@t.com,D\ne@t.com,E\nf@t.com,F';
    const engine = new BatchEngine({
      batchSize: 2,
      maxConcurrentBatches: 3,
      maxRetries: 2,
      retryDelayMs: 0,
      continueOnError: true,
    });
    engine.from(new BufferSource(sixRecords), simpleCsvParser());

    const attempts = new Map<string, number>();
    await engine.start(async (record) => {
      const email = record.email as string;
      const count = (attempts.get(email) ?? 0) + 1;
      attempts.set(email, count);

      // First attempt of c@t.com and e@t.com fails
      if ((email === 'c@t.com' || email === 'e@t.com') && count === 1) {
        throw new Error('Transient');
      }
      await Promise.resolve();
    });

    expect(engine.getStatus().status).toBe('COMPLETED');
    expect(attempts.get('c@t.com')).toBe(2);
    expect(attempts.get('e@t.com')).toBe(2);

    const failed = await engine.getFailedRecords();
    expect(failed).toHaveLength(0);
  });
});
