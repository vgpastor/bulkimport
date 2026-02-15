import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { StateStore, BatchState } from '../../domain/ports/StateStore.js';
import type { ImportJobState, ImportProgress } from '../../domain/model/ImportJob.js';
import type { ProcessedRecord } from '../../domain/model/Record.js';

export interface FileStateStoreOptions {
  /** Directory where job state files are stored. Default: `'.bulkimport'`. */
  readonly directory?: string;
}

/**
 * File-based state store that persists job state as JSON files on disk.
 *
 * Each job is stored in two files:
 * - `{jobId}.json` — job state (config, status, batches, counters)
 * - `{jobId}.records.json` — processed records (for recovery)
 *
 * Node.js only. Not suitable for browsers.
 */
export class FileStateStore implements StateStore {
  private readonly directory: string;

  constructor(options?: FileStateStoreOptions) {
    this.directory = options?.directory ?? '.bulkimport';
  }

  async saveJobState(job: ImportJobState): Promise<void> {
    await this.ensureDirectory();
    const filePath = this.jobFilePath(job.id);
    await writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');
  }

  async getJobState(jobId: string): Promise<ImportJobState | null> {
    try {
      const content = await readFile(this.jobFilePath(jobId), 'utf-8');
      return JSON.parse(content) as ImportJobState;
    } catch {
      return null;
    }
  }

  async updateBatchState(jobId: string, batchId: string, state: BatchState): Promise<void> {
    const job = await this.getJobState(jobId);
    if (!job) return;

    const batches = job.batches.map((b) =>
      b.id === batchId
        ? { ...b, status: state.status, processedCount: state.processedCount, failedCount: state.failedCount }
        : b,
    );

    await this.saveJobState({ ...job, batches });
  }

  async saveProcessedRecord(jobId: string, _batchId: string, record: ProcessedRecord): Promise<void> {
    const records = await this.loadRecords(jobId);
    const index = records.findIndex((r) => r.index === record.index);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }
    await this.saveRecords(jobId, records);
  }

  async getFailedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const records = await this.loadRecords(jobId);
    return records.filter((r) => r.status === 'failed' || r.status === 'invalid');
  }

  async getPendingRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const records = await this.loadRecords(jobId);
    return records.filter((r) => r.status === 'pending' || r.status === 'valid');
  }

  async getProcessedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const records = await this.loadRecords(jobId);
    return records.filter((r) => r.status === 'processed');
  }

  async getProgress(jobId: string): Promise<ImportProgress> {
    const job = await this.getJobState(jobId);
    const records = await this.loadRecords(jobId);
    const processed = records.filter((r) => r.status === 'processed').length;
    const failed = records.filter((r) => r.status === 'failed' || r.status === 'invalid').length;
    const total = job?.totalRecords ?? records.length;
    const pending = total - processed - failed;
    const elapsed = job?.startedAt ? Date.now() - job.startedAt : 0;

    const currentBatch = job?.batches.filter((b) => b.status === 'COMPLETED').length ?? 0;
    const totalBatches = job?.batches.length ?? 0;

    return {
      totalRecords: total,
      processedRecords: processed,
      failedRecords: failed,
      pendingRecords: pending,
      percentage: total > 0 ? Math.round((processed / total) * 100) : 0,
      currentBatch,
      totalBatches,
      elapsedMs: elapsed,
    };
  }

  private async loadRecords(jobId: string): Promise<ProcessedRecord[]> {
    try {
      const content = await readFile(this.recordsFilePath(jobId), 'utf-8');
      return JSON.parse(content) as ProcessedRecord[];
    } catch {
      return [];
    }
  }

  private async saveRecords(jobId: string, records: ProcessedRecord[]): Promise<void> {
    await this.ensureDirectory();
    await writeFile(this.recordsFilePath(jobId), JSON.stringify(records), 'utf-8');
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  private jobFilePath(jobId: string): string {
    return join(this.directory, `${jobId}.json`);
  }

  private recordsFilePath(jobId: string): string {
    return join(this.directory, `${jobId}.records.json`);
  }
}
