import { DataTypes } from 'sequelize';
import type { Sequelize, ModelStatic, Model } from 'sequelize';

export interface JobRow {
  id: string;
  status: string;
  config: unknown;
  batches: unknown;
  totalRecords: number;
  startedAt: number | null;
  completedAt: number | null;
}

export type JobModel = ModelStatic<Model>;

export function defineJobModel(sequelize: Sequelize): JobModel {
  return sequelize.define(
    'BulkImportJob',
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      config: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      batches: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      totalRecords: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      startedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      completedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
    },
    {
      tableName: 'bulkimport_jobs',
      timestamps: false,
    },
  );
}
