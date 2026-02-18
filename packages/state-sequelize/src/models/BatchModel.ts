import { DataTypes } from 'sequelize';
import type { Sequelize, ModelStatic, Model } from 'sequelize';

export interface BatchRow {
  id: string;
  jobId: string;
  batchIndex: number;
  status: string;
  workerId: string | null;
  claimedAt: number | string | null;
  recordStartIndex: number;
  recordEndIndex: number;
  processedCount: number;
  failedCount: number;
  version: number;
}

export type BatchModel = ModelStatic<Model>;

export function defineBatchModel(sequelize: Sequelize): BatchModel {
  return sequelize.define(
    'BatchActionsBatch',
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      jobId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      batchIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      workerId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      claimedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      recordStartIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      recordEndIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      processedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      failedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'batchactions_batches',
      timestamps: false,
      indexes: [{ fields: ['jobId', 'status'] }, { unique: true, fields: ['jobId', 'batchIndex'] }],
    },
  );
}
