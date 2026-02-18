import type { Sequelize, Transaction } from 'sequelize';
import type {
  BatchState,
  JobState,
  JobProgress,
  ProcessedRecord,
  DistributedStateStore,
  ClaimBatchResult,
  DistributedJobStatus,
} from '@batchactions/core';
import { defineJobModel } from './models/JobModel.js';
import type { JobModel, JobRow } from './models/JobModel.js';
import { defineRecordModel } from './models/RecordModel.js';
import type { RecordModel, RecordRow } from './models/RecordModel.js';
import { defineBatchModel } from './models/BatchModel.js';
import type { BatchModel, BatchRow } from './models/BatchModel.js';
import * as JobMapper from './mappers/JobMapper.js';
import * as RecordMapper from './mappers/RecordMapper.js';
import { parseJson } from './utils/parseJson.js';

export interface SequelizeStateStoreOptions {
  readonly tablePrefix?: string;
}

/**
 * Sequelize-based StateStore adapter for `@batchactions/core`.
 *
 * Persists import job state and processed records to a relational database
 * using Sequelize v6. Supports any dialect supported by Sequelize (PostgreSQL,
 * MySQL, MariaDB, SQLite, MS SQL Server).
 *
 * Also implements `DistributedStateStore` for distributed multi-worker
 * batch processing with atomic batch claiming and job finalization.
 *
 * Call `initialize()` after construction to create tables.
 *
 * **Limitation:** Non-serializable schema fields (`customValidator`, `transform`,
 * `pattern`) are stripped when saving. The consumer must re-inject them when
 * restoring a job from the database.
 */
export class SequelizeStateStore implements DistributedStateStore {
  private readonly sequelize: Sequelize;
  private readonly Job: JobModel;
  private readonly Record: RecordModel;
  private readonly Batch: BatchModel;

  constructor(sequelize: Sequelize, _options?: SequelizeStateStoreOptions) {
    this.sequelize = sequelize;
    this.Job = defineJobModel(this.sequelize);
    this.Record = defineRecordModel(this.sequelize);
    this.Batch = defineBatchModel(this.sequelize);
  }

  async initialize(): Promise<void> {
    await this.Job.sync();
    await this.Record.sync();
    await this.Batch.sync();
  }

  // ── StateStore methods ──────────────────────────────────────────────

  async saveJobState(job: JobState): Promise<void> {
    const row = JobMapper.toRow(job);
    await this.Job.upsert(row as unknown as Record<string, unknown>);
  }

  async getJobState(jobId: string): Promise<JobState | null> {
    const row = await this.Job.findByPk(jobId);
    if (!row) return null;
    return JobMapper.toDomain(row.get({ plain: true }) as JobRow);
  }

  async updateBatchState(jobId: string, batchId: string, state: BatchState): Promise<void> {
    const row = await this.Job.findByPk(jobId);
    if (!row) return;

    const plain = row.get({ plain: true }) as JobRow;
    const batches = parseJson(plain.batches) as Array<{
      id: string;
      status: string;
      processedCount: number;
      failedCount: number;
    }>;

    const updated = batches.map((b) =>
      b.id === batchId
        ? { ...b, status: state.status, processedCount: state.processedCount, failedCount: state.failedCount }
        : b,
    );

    await row.update({ batches: updated });

    // Also update the distributed batch table if it exists
    const batchRow = await this.Batch.findByPk(batchId);
    if (batchRow) {
      await batchRow.update({
        status: state.status,
        processedCount: state.processedCount,
        failedCount: state.failedCount,
      });
    }
  }

  async saveProcessedRecord(jobId: string, batchId: string, record: ProcessedRecord): Promise<void> {
    const row = RecordMapper.toRow(jobId, batchId, record);

    const existing = await this.Record.findOne({
      where: { jobId, recordIndex: record.index },
    });

    if (existing) {
      await existing.update(row);
    } else {
      await this.Record.create(row as unknown as Record<string, unknown>);
    }
  }

  async getFailedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const { Op } = await import('sequelize');
    const rows = await this.Record.findAll({
      where: { jobId, status: { [Op.in]: ['failed', 'invalid'] } },
      order: [['recordIndex', 'ASC']],
    });
    return rows.map((r) => RecordMapper.toDomain(r.get({ plain: true }) as RecordRow));
  }

  async getPendingRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const { Op } = await import('sequelize');
    const rows = await this.Record.findAll({
      where: { jobId, status: { [Op.in]: ['pending', 'valid'] } },
      order: [['recordIndex', 'ASC']],
    });
    return rows.map((r) => RecordMapper.toDomain(r.get({ plain: true }) as RecordRow));
  }

  async getProcessedRecords(jobId: string): Promise<readonly ProcessedRecord[]> {
    const rows = await this.Record.findAll({
      where: { jobId, status: 'processed' },
      order: [['recordIndex', 'ASC']],
    });
    return rows.map((r) => RecordMapper.toDomain(r.get({ plain: true }) as RecordRow));
  }

  async getProgress(jobId: string): Promise<JobProgress> {
    const jobRow = await this.Job.findByPk(jobId);
    const plain = jobRow ? (jobRow.get({ plain: true }) as JobRow) : null;

    const { fn, col } = await import('sequelize');
    const counts = (await this.Record.findAll({
      attributes: ['status', [fn('COUNT', col('status')), 'count']],
      where: { jobId },
      group: ['status'],
      raw: true,
    })) as unknown as Array<{ status: string; count: string }>;

    const countMap = new Map<string, number>();
    for (const row of counts) {
      countMap.set(row.status, parseInt(row.count, 10));
    }

    const processed = countMap.get('processed') ?? 0;
    const failed = (countMap.get('failed') ?? 0) + (countMap.get('invalid') ?? 0);
    const totalRecords = plain?.totalRecords ?? 0;
    const pending = Math.max(0, totalRecords - processed - failed);
    const completed = processed + failed;

    const batches = plain ? (parseJson(plain.batches) as Array<{ status: string }>) : [];
    const completedBatches = batches.filter((b) => b.status === 'COMPLETED').length;
    const elapsed = plain?.startedAt ? Date.now() - Number(plain.startedAt) : 0;

    return {
      totalRecords,
      processedRecords: processed,
      failedRecords: failed,
      pendingRecords: pending,
      percentage: totalRecords > 0 ? Math.round((completed / totalRecords) * 100) : 0,
      currentBatch: completedBatches,
      totalBatches: batches.length,
      elapsedMs: elapsed,
    };
  }

  // ── DistributedStateStore methods ───────────────────────────────────

  async claimBatch(jobId: string, workerId: string): Promise<ClaimBatchResult> {
    const jobRow = await this.Job.findByPk(jobId);
    if (!jobRow) {
      return { claimed: false, reason: 'JOB_NOT_FOUND' };
    }

    const plain = jobRow.get({ plain: true }) as JobRow;
    if (plain.status !== 'PROCESSING') {
      return { claimed: false, reason: 'JOB_NOT_PROCESSING' };
    }

    // Use a transaction with optimistic locking via version column
    return await this.sequelize.transaction(async (transaction) => {
      // Find the first PENDING batch for this job, ordered by batchIndex
      const pendingBatch = await this.Batch.findOne({
        where: { jobId, status: 'PENDING' },
        order: [['batchIndex', 'ASC']],
        transaction,
        lock: true,
      });

      if (!pendingBatch) {
        return { claimed: false as const, reason: 'NO_PENDING_BATCHES' as const };
      }

      const batchPlain = pendingBatch.get({ plain: true }) as BatchRow;
      const now = Date.now();

      // Optimistic lock: update only if version matches
      const [affectedRows] = await this.Batch.update(
        {
          status: 'PROCESSING',
          workerId,
          claimedAt: now,
          version: batchPlain.version + 1,
        },
        {
          where: {
            id: batchPlain.id,
            version: batchPlain.version,
          },
          transaction,
        },
      );

      if (affectedRows === 0) {
        // Race condition: another worker claimed it first
        return { claimed: false as const, reason: 'NO_PENDING_BATCHES' as const };
      }

      // Also update the JSON batches in the job row for consistency
      const jobBatches = parseJson(plain.batches) as Array<{
        id: string;
        status: string;
        processedCount: number;
        failedCount: number;
      }>;
      const updatedBatches = jobBatches.map((b) => (b.id === batchPlain.id ? { ...b, status: 'PROCESSING' } : b));
      await jobRow.update({ batches: updatedBatches }, { transaction });

      return {
        claimed: true as const,
        reservation: {
          jobId,
          batchId: batchPlain.id,
          batchIndex: batchPlain.batchIndex,
          workerId,
          claimedAt: now,
          recordStartIndex: batchPlain.recordStartIndex,
          recordEndIndex: batchPlain.recordEndIndex,
        },
      };
    });
  }

  async releaseBatch(jobId: string, batchId: string, workerId: string): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const batch = await this.Batch.findOne({
        where: { id: batchId, jobId, workerId },
        transaction,
        lock: true,
      });

      if (!batch) return;

      const batchPlain = batch.get({ plain: true }) as BatchRow;
      await this.Batch.update(
        {
          status: 'PENDING',
          workerId: null,
          claimedAt: null,
          version: batchPlain.version + 1,
        },
        {
          where: { id: batchId, version: batchPlain.version },
          transaction,
        },
      );

      // Update job batches JSON for consistency
      const jobRow = await this.Job.findByPk(jobId, { transaction });
      if (jobRow) {
        const plain = jobRow.get({ plain: true }) as JobRow;
        const jobBatches = parseJson(plain.batches) as Array<{ id: string; status: string }>;
        const updatedBatches = jobBatches.map((b) => (b.id === batchId ? { ...b, status: 'PENDING' } : b));
        await jobRow.update({ batches: updatedBatches }, { transaction });
      }
    });
  }

  async reclaimStaleBatches(jobId: string, timeoutMs: number): Promise<number> {
    const cutoff = Date.now() - timeoutMs;
    const { Op } = await import('sequelize');

    return await this.sequelize.transaction(async (transaction) => {
      const staleBatches = await this.Batch.findAll({
        where: {
          jobId,
          status: 'PROCESSING',
          claimedAt: { [Op.lt]: cutoff },
        },
        transaction,
        lock: true,
      });

      if (staleBatches.length === 0) return 0;

      let reclaimed = 0;
      for (const batch of staleBatches) {
        const batchPlain = batch.get({ plain: true }) as BatchRow;
        const [affected] = await this.Batch.update(
          {
            status: 'PENDING',
            workerId: null,
            claimedAt: null,
            version: batchPlain.version + 1,
          },
          {
            where: { id: batchPlain.id, version: batchPlain.version },
            transaction,
          },
        );
        reclaimed += affected;
      }

      // Update job batches JSON for consistency
      if (reclaimed > 0) {
        const reclaimedIds = new Set(staleBatches.map((b) => (b.get({ plain: true }) as BatchRow).id));
        const jobRow = await this.Job.findByPk(jobId, { transaction });
        if (jobRow) {
          const plain = jobRow.get({ plain: true }) as JobRow;
          const jobBatches = parseJson(plain.batches) as Array<{ id: string; status: string }>;
          const updatedBatches = jobBatches.map((b) => (reclaimedIds.has(b.id) ? { ...b, status: 'PENDING' } : b));
          await jobRow.update({ batches: updatedBatches }, { transaction });
        }
      }

      return reclaimed;
    });
  }

  async saveBatchRecords(jobId: string, batchId: string, records: readonly ProcessedRecord[]): Promise<void> {
    const rows = records.map((r) => RecordMapper.toRow(jobId, batchId, r));
    await this.Record.bulkCreate(rows as unknown as Array<Record<string, unknown>>);
  }

  async getBatchRecords(jobId: string, batchId: string): Promise<readonly ProcessedRecord[]> {
    const rows = await this.Record.findAll({
      where: { jobId, batchId },
      order: [['recordIndex', 'ASC']],
    });
    return rows.map((r) => RecordMapper.toDomain(r.get({ plain: true }) as RecordRow));
  }

  async getDistributedStatus(jobId: string): Promise<DistributedJobStatus> {
    const { fn, col } = await import('sequelize');
    const counts = (await this.Batch.findAll({
      attributes: ['status', [fn('COUNT', col('status')), 'count']],
      where: { jobId },
      group: ['status'],
      raw: true,
    })) as unknown as Array<{ status: string; count: string }>;

    const countMap = new Map<string, number>();
    let total = 0;
    for (const row of counts) {
      const count = parseInt(row.count, 10);
      countMap.set(row.status, count);
      total += count;
    }

    const completed = countMap.get('COMPLETED') ?? 0;
    const failed = countMap.get('FAILED') ?? 0;
    const processing = countMap.get('PROCESSING') ?? 0;
    const pending = countMap.get('PENDING') ?? 0;

    return {
      jobId,
      totalBatches: total,
      completedBatches: completed,
      failedBatches: failed,
      processingBatches: processing,
      pendingBatches: pending,
      isComplete: total > 0 && pending === 0 && processing === 0,
    };
  }

  async tryFinalizeJob(jobId: string): Promise<boolean> {
    return await this.sequelize.transaction(async (transaction) => {
      const jobRow = await this.Job.findByPk(jobId, { transaction, lock: true });
      if (!jobRow) return false;

      const plain = jobRow.get({ plain: true }) as JobRow;
      if (plain.status !== 'PROCESSING') return false;

      // Check if all batches are in terminal state
      const status = await this.getDistributedStatusInTransaction(jobId, transaction);
      if (!status.isComplete) return false;

      // Determine final status: FAILED if any batch failed, COMPLETED otherwise
      const finalStatus = status.failedBatches > 0 ? 'FAILED' : 'COMPLETED';

      // Atomic update: only transition if still PROCESSING
      const [affectedRows] = await this.Job.update(
        {
          status: finalStatus,
          completedAt: Date.now(),
        },
        {
          where: { id: jobId, status: 'PROCESSING' },
          transaction,
        },
      );

      return affectedRows > 0;
    });
  }

  /**
   * Internal helper to get distributed status within an existing transaction.
   * Avoids creating a nested transaction in tryFinalizeJob.
   */
  private async getDistributedStatusInTransaction(
    jobId: string,
    transaction: Transaction,
  ): Promise<DistributedJobStatus> {
    const { fn, col } = await import('sequelize');
    const counts = (await this.Batch.findAll({
      attributes: ['status', [fn('COUNT', col('status')), 'count']],
      where: { jobId },
      group: ['status'],
      raw: true,
      transaction,
    })) as unknown as Array<{ status: string; count: string }>;

    const countMap = new Map<string, number>();
    let total = 0;
    for (const row of counts) {
      const count = parseInt(row.count, 10);
      countMap.set(row.status, count);
      total += count;
    }

    const completed = countMap.get('COMPLETED') ?? 0;
    const failed = countMap.get('FAILED') ?? 0;
    const processing = countMap.get('PROCESSING') ?? 0;
    const pending = countMap.get('PENDING') ?? 0;

    return {
      jobId,
      totalBatches: total,
      completedBatches: completed,
      failedBatches: failed,
      processingBatches: processing,
      pendingBatches: pending,
      isComplete: total > 0 && pending === 0 && processing === 0,
    };
  }
}
