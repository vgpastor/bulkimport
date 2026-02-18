import type { JobStatus } from '../../domain/model/JobStatus.js';
import type { JobProgress } from '../../domain/model/Job.js';
import type { Batch } from '../../domain/model/Batch.js';
import type { ProcessedRecord } from '../../domain/model/Record.js';
import type { JobContext } from '../JobContext.js';

/** Result of querying import job status. */
export interface JobStatusResult {
  /** Current job status. */
  readonly status: JobStatus;
  /** @deprecated Use `status` instead. Will be removed in the next major version. */
  readonly state: JobStatus;
  readonly progress: JobProgress;
  readonly batches: readonly Batch[];
}

/** Use case: query the current state, progress, and batch details of an import job. */
export class GetJobStatus {
  constructor(private readonly ctx: JobContext) {}

  execute(): JobStatusResult {
    const currentStatus = this.ctx.status;
    return {
      status: currentStatus,
      state: currentStatus,
      progress: this.ctx.buildProgress(),
      batches: this.ctx.batches,
    };
  }

  async getFailedRecords(): Promise<readonly ProcessedRecord[]> {
    return this.ctx.stateStore.getFailedRecords(this.ctx.jobId);
  }

  getPendingRecords(): readonly ProcessedRecord[] {
    return [];
  }

  getJobId(): string {
    return this.ctx.jobId;
  }
}
