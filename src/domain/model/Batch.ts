import type { BatchStatus } from './BatchStatus.js';
import type { ProcessedRecord } from './Record.js';

export interface Batch {
  readonly id: string;
  readonly index: number;
  readonly status: BatchStatus;
  readonly records: readonly ProcessedRecord[];
  readonly processedCount: number;
  readonly failedCount: number;
}

export function createBatch(id: string, index: number, records: readonly ProcessedRecord[]): Batch {
  return {
    id,
    index,
    status: 'PENDING',
    records,
    processedCount: 0,
    failedCount: 0,
  };
}

export function updateBatch(batch: Batch, updates: Partial<Pick<Batch, 'status' | 'records' | 'processedCount' | 'failedCount'>>): Batch {
  return { ...batch, ...updates };
}
