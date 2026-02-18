import type { StateStore, BatchState } from '../../domain/ports/StateStore.js';
import type { JobState, JobProgress } from '../../domain/model/Job.js';
import type { ProcessedRecord } from '../../domain/model/Record.js';

/** Non-persistent in-memory state store. Used as the default when no custom StateStore is provided. */
export class InMemoryStateStore implements StateStore {
  private jobs = new Map<string, JobState>();
  private records = new Map<string, Map<number, ProcessedRecord>>();

  saveJobState(job: JobState): Promise<void> {
    this.jobs.set(job.id, job);
    return Promise.resolve();
  }

  getJobState(jobId: string): Promise<JobState | null> {
    return Promise.resolve(this.jobs.get(jobId) ?? null);
  }

  updateBatchState(jobId: string, batchId: string, state: BatchState): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve();

    const batches = job.batches.map((b) =>
      b.id === batchId
        ? { ...b, status: state.status, processedCount: state.processedCount, failedCount: state.failedCount }
        : b,
    );

    this.jobs.set(jobId, { ...job, batches });
    return Promise.resolve();
  }

  saveProcessedRecord(jobId: string, _batchId: string, record: ProcessedRecord): Promise<void> {
    let recordMap = this.records.get(jobId);
    if (!recordMap) {
      recordMap = new Map();
      this.records.set(jobId, recordMap);
    }
    recordMap.set(record.index, record);
    return Promise.resolve();
  }

  getFailedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const recordMap = this.records.get(jobId);
    if (!recordMap) return Promise.resolve([]);
    return Promise.resolve([...recordMap.values()].filter((r) => r.status === 'failed' || r.status === 'invalid'));
  }

  getPendingRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const recordMap = this.records.get(jobId);
    if (!recordMap) return Promise.resolve([]);
    return Promise.resolve([...recordMap.values()].filter((r) => r.status === 'pending' || r.status === 'valid'));
  }

  getProcessedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const recordMap = this.records.get(jobId);
    if (!recordMap) return Promise.resolve([]);
    return Promise.resolve([...recordMap.values()].filter((r) => r.status === 'processed'));
  }

  getProgress(jobId: string): Promise<JobProgress> {
    const job = this.jobs.get(jobId);
    const recordMap = this.records.get(jobId);
    const all = recordMap ? [...recordMap.values()] : [];
    const processed = all.filter((r) => r.status === 'processed').length;
    const failed = all.filter((r) => r.status === 'failed' || r.status === 'invalid').length;
    const total = job?.totalRecords ?? all.length;
    const pending = total - processed - failed;
    const elapsed = job?.startedAt ? Date.now() - job.startedAt : 0;

    const currentBatch = job?.batches.filter((b) => b.status === 'COMPLETED').length ?? 0;
    const totalBatches = job?.batches.length ?? 0;

    return Promise.resolve({
      totalRecords: total,
      processedRecords: processed,
      failedRecords: failed,
      pendingRecords: pending,
      percentage: total > 0 ? Math.round((processed / total) * 100) : 0,
      currentBatch,
      totalBatches,
      elapsedMs: elapsed,
    });
  }
}
