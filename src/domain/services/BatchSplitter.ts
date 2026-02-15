import type { ProcessedRecord } from '../model/Record.js';

/**
 * Domain service that groups a stream of records into fixed-size batches.
 *
 * Pure logic — no I/O, no side effects. Operates as an async generator that
 * yields batches (arrays of records) as they fill up.
 */
export class BatchSplitter {
  constructor(private readonly batchSize: number) {
    if (batchSize < 1) {
      throw new Error('Batch size must be at least 1');
    }
  }

  /**
   * Split a stream of records into batches of `batchSize`.
   *
   * Yields a `{ records, batchIndex }` tuple for each full batch.
   * The final batch may contain fewer records than `batchSize`.
   *
   * @param records - Async iterable of records to split.
   * @param startIndex - Starting batch index (for resume support). Default: `0`.
   */
  async *split(
    records: AsyncIterable<ProcessedRecord>,
    startIndex = 0,
  ): AsyncIterable<{ readonly records: readonly ProcessedRecord[]; readonly batchIndex: number }> {
    let buffer: ProcessedRecord[] = [];
    let batchIndex = startIndex;

    for await (const record of records) {
      buffer.push(record);

      if (buffer.length >= this.batchSize) {
        yield { records: buffer, batchIndex };
        buffer = [];
        batchIndex++;
      }
    }

    if (buffer.length > 0) {
      yield { records: buffer, batchIndex };
    }
  }
}
