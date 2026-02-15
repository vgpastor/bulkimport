import { DataTypes } from 'sequelize';
import type { Sequelize, ModelStatic, Model } from 'sequelize';

export interface RecordRow {
  id?: number;
  jobId: string;
  batchId: string;
  recordIndex: number;
  status: string;
  raw: unknown;
  parsed: unknown;
  errors: unknown;
  processingError: string | null;
}

export type RecordModel = ModelStatic<Model>;

export function defineRecordModel(sequelize: Sequelize): RecordModel {
  return sequelize.define(
    'BulkImportRecord',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      jobId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      batchId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      recordIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      raw: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      parsed: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      errors: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      processingError: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'bulkimport_records',
      timestamps: false,
      indexes: [
        { fields: ['jobId', 'status'] },
        { fields: ['jobId', 'batchId'] },
        { unique: true, fields: ['jobId', 'recordIndex'] },
      ],
    },
  );
}
