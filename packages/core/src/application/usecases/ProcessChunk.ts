import type { RecordProcessorFn } from '../../domain/ports/RecordProcessor.js';
import type { JobContext } from '../JobContext.js';
import { StartJob } from './StartJob.js';

/** Options controlling how many records or how long a chunk processes. */
export interface ChunkOptions {
  /** Stop after processing this many records in this chunk. */
  readonly maxRecords?: number;
  /** Stop after this many milliseconds have elapsed in this chunk. */
  readonly maxDurationMs?: number;
}

/** Result returned by `processChunk()`. */
export interface ChunkResult {
  /** `true` when all records have been processed (import complete). */
  readonly done: boolean;
  /** Records successfully processed in this chunk. */
  readonly processedRecords: number;
  /** Records that failed in this chunk. */
  readonly failedRecords: number;
  /** Cumulative records processed across all chunks. */
  readonly totalProcessed: number;
  /** Cumulative records failed across all chunks. */
  readonly totalFailed: number;
  /** The job identifier (needed for subsequent `restore()` calls). */
  readonly jobId: string;
}

/**
 * Use case: process a limited chunk of records, then pause and return control.
 *
 * Designed for serverless environments with execution time limits (e.g. Vercel, Lambda).
 * Chunk boundaries are at the batch level: the current batch always completes
 * before the chunk stops. Control granularity with `batchSize`.
 */
export class ProcessChunk {
  constructor(private readonly ctx: JobContext) {}

  async execute(processor: RecordProcessorFn, options?: ChunkOptions): Promise<ChunkResult> {
    this.ctx.chunkLimits = options ?? null;
    this.ctx.chunkStartTime = Date.now();
    this.ctx.chunkRecordCount = 0;
    this.ctx.chunkExhausted = false;

    const beforeProcessed = this.ctx.processedCount;
    const beforeFailed = this.ctx.failedCount;

    await new StartJob(this.ctx).execute(processor);

    const done = this.ctx.status === 'COMPLETED';
    const chunkProcessed = this.ctx.processedCount - beforeProcessed;
    const chunkFailed = this.ctx.failedCount - beforeFailed;

    this.ctx.eventBus.emit({
      type: 'chunk:completed',
      jobId: this.ctx.jobId,
      processedRecords: chunkProcessed,
      failedRecords: chunkFailed,
      done,
      timestamp: Date.now(),
    });

    // Clear chunk state
    this.ctx.chunkLimits = null;
    this.ctx.chunkStartTime = null;

    return {
      done,
      processedRecords: chunkProcessed,
      failedRecords: chunkFailed,
      totalProcessed: this.ctx.processedCount,
      totalFailed: this.ctx.failedCount,
      jobId: this.ctx.jobId,
    };
  }
}
