import type { ImportJobState, ImportProgress } from '../model/ImportJob.js';
import type { BatchStatus } from '../model/BatchStatus.js';
import type { ProcessedRecord } from '../model/Record.js';

export interface BatchState {
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly processedCount: number;
  readonly failedCount: number;
}

export interface StateStore {
  saveJobState(job: ImportJobState): Promise<void>;
  getJobState(jobId: string): Promise<ImportJobState | null>;
  updateBatchState(jobId: string, batchId: string, state: BatchState): Promise<void>;
  saveProcessedRecord(jobId: string, batchId: string, record: ProcessedRecord): Promise<void>;
  getFailedRecords(jobId: string): Promise<readonly ProcessedRecord[]>;
  getPendingRecords(jobId: string): Promise<readonly ProcessedRecord[]>;
  getProcessedRecords(jobId: string): Promise<readonly ProcessedRecord[]>;
  getProgress(jobId: string): Promise<ImportProgress>;
}
