import type { Sequelize } from 'sequelize';
import type { StateStore, BatchState, ImportJobState, ImportProgress, ProcessedRecord } from '@bulkimport/core';
import { defineJobModel } from './models/JobModel.js';
import type { JobModel, JobRow } from './models/JobModel.js';
import { defineRecordModel } from './models/RecordModel.js';
import type { RecordModel, RecordRow } from './models/RecordModel.js';
import * as JobMapper from './mappers/JobMapper.js';
import * as RecordMapper from './mappers/RecordMapper.js';

export interface SequelizeStateStoreOptions {
  readonly tablePrefix?: string;
}

/**
 * Sequelize-based StateStore adapter for `@bulkimport/core`.
 *
 * Persists import job state and processed records to a relational database
 * using Sequelize v6. Supports any dialect supported by Sequelize (PostgreSQL,
 * MySQL, MariaDB, SQLite, MS SQL Server).
 *
 * Call `initialize()` after construction to create tables.
 *
 * **Limitation:** Non-serializable schema fields (`customValidator`, `transform`,
 * `pattern`) are stripped when saving. The consumer must re-inject them when
 * restoring a job from the database.
 */
export class SequelizeStateStore implements StateStore {
  private readonly sequelize: Sequelize;
  private readonly Job: JobModel;
  private readonly Record: RecordModel;

  constructor(sequelize: Sequelize, _options?: SequelizeStateStoreOptions) {
    this.sequelize = sequelize;
    this.Job = defineJobModel(this.sequelize);
    this.Record = defineRecordModel(this.sequelize);
  }

  async initialize(): Promise<void> {
    await this.Job.sync();
    await this.Record.sync();
  }

  async saveJobState(job: ImportJobState): Promise<void> {
    const row = JobMapper.toRow(job);
    await this.Job.upsert(row as unknown as Record<string, unknown>);
  }

  async getJobState(jobId: string): Promise<ImportJobState | null> {
    const row = await this.Job.findByPk(jobId);
    if (!row) return null;
    return JobMapper.toDomain(row.get({ plain: true }) as JobRow);
  }

  async updateBatchState(jobId: string, batchId: string, state: BatchState): Promise<void> {
    const row = await this.Job.findByPk(jobId);
    if (!row) return;

    const plain = row.get({ plain: true }) as JobRow;
    const batches = plain.batches as Array<{ id: string; status: string; processedCount: number; failedCount: number }>;

    const updated = batches.map((b) =>
      b.id === batchId
        ? { ...b, status: state.status, processedCount: state.processedCount, failedCount: state.failedCount }
        : b,
    );

    await row.update({ batches: updated });
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

  async getProgress(jobId: string): Promise<ImportProgress> {
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

    const batches = (plain?.batches ?? []) as Array<{ status: string }>;
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
}
