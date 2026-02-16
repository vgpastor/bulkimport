import type { ImportStatus } from '../../domain/model/ImportStatus.js';
import type { ImportProgress } from '../../domain/model/ImportJob.js';
import type { Batch } from '../../domain/model/Batch.js';
import type { ProcessedRecord } from '../../domain/model/Record.js';
import type { ImportJobContext } from '../ImportJobContext.js';

/** Result of querying import job status. */
export interface ImportStatusResult {
  /** Current import status. */
  readonly status: ImportStatus;
  /** @deprecated Use `status` instead. Will be removed in the next major version. */
  readonly state: ImportStatus;
  readonly progress: ImportProgress;
  readonly batches: readonly Batch[];
}

/** Use case: query the current state, progress, and batch details of an import job. */
export class GetImportStatus {
  constructor(private readonly ctx: ImportJobContext) {}

  execute(): ImportStatusResult {
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
