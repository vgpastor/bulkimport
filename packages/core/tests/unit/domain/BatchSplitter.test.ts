import { describe, it, expect } from 'vitest';
import { BatchSplitter } from '../../../src/domain/services/BatchSplitter.js';
import { createPendingRecord } from '../../../src/domain/model/Record.js';
import type { ProcessedRecord } from '../../../src/domain/model/Record.js';

async function* generateRecords(count: number) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
    yield createPendingRecord(i, { value: `record-${String(i)}` });
  }
}

async function collectBatches(splitter: BatchSplitter, count: number, startIndex = 0) {
  const batches: { records: readonly ProcessedRecord[]; batchIndex: number }[] = [];
  for await (const batch of splitter.split(generateRecords(count), startIndex)) {
    batches.push(batch);
  }
  return batches;
}

describe('BatchSplitter', () => {
  describe('constructor', () => {
    it('should throw when batch size is less than 1', () => {
      expect(() => new BatchSplitter(0)).toThrow('Batch size must be at least 1');
      expect(() => new BatchSplitter(-5)).toThrow('Batch size must be at least 1');
    });

    it('should accept batch size of 1', () => {
      expect(() => new BatchSplitter(1)).not.toThrow();
    });
  });

  describe('split', () => {
    it('should split records into batches of the configured size', async () => {
      const splitter = new BatchSplitter(3);
      const batches = await collectBatches(splitter, 7);

      expect(batches).toHaveLength(3);
      expect(batches[0]!.records).toHaveLength(3);
      expect(batches[1]!.records).toHaveLength(3);
      expect(batches[2]!.records).toHaveLength(1);
    });

    it('should assign sequential batch indices starting from 0', async () => {
      const splitter = new BatchSplitter(2);
      const batches = await collectBatches(splitter, 5);

      expect(batches.map((b) => b.batchIndex)).toEqual([0, 1, 2]);
    });

    it('should support custom start index for resume', async () => {
      const splitter = new BatchSplitter(2);
      const batches = await collectBatches(splitter, 4, 5);

      expect(batches.map((b) => b.batchIndex)).toEqual([5, 6]);
    });

    it('should yield nothing for empty input', async () => {
      const splitter = new BatchSplitter(10);
      const batches = await collectBatches(splitter, 0);

      expect(batches).toHaveLength(0);
    });

    it('should yield a single batch when records fit exactly', async () => {
      const splitter = new BatchSplitter(5);
      const batches = await collectBatches(splitter, 5);

      expect(batches).toHaveLength(1);
      expect(batches[0]!.records).toHaveLength(5);
      expect(batches[0]!.batchIndex).toBe(0);
    });

    it('should yield a single partial batch when records are fewer than batch size', async () => {
      const splitter = new BatchSplitter(100);
      const batches = await collectBatches(splitter, 3);

      expect(batches).toHaveLength(1);
      expect(batches[0]!.records).toHaveLength(3);
    });

    it('should handle batch size of 1 (one record per batch)', async () => {
      const splitter = new BatchSplitter(1);
      const batches = await collectBatches(splitter, 4);

      expect(batches).toHaveLength(4);
      batches.forEach((batch, i) => {
        expect(batch.records).toHaveLength(1);
        expect(batch.batchIndex).toBe(i);
      });
    });

    it('should preserve record order within each batch', async () => {
      const splitter = new BatchSplitter(3);
      const batches = await collectBatches(splitter, 6);

      expect(batches[0]!.records.map((r) => r.index)).toEqual([0, 1, 2]);
      expect(batches[1]!.records.map((r) => r.index)).toEqual([3, 4, 5]);
    });
  });
});
