import type { RawRecord } from '../model/Record.js';

export interface ProcessingContext {
  readonly jobId: string;
  readonly batchId: string;
  readonly batchIndex: number;
  readonly recordIndex: number;
  readonly totalRecords: number;
  readonly signal: AbortSignal;
}

export type RecordProcessorFn = (record: RawRecord, context: ProcessingContext) => Promise<void>;
