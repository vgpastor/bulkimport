import type { ImportJobState, ImportJobConfig } from '@bulkimport/core';
import type { JobRow } from '../models/JobModel.js';
import { parseJson } from '../utils/parseJson.js';

interface SerializableFieldDefinition {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly defaultValue?: unknown;
  readonly separator?: string;
  readonly aliases?: readonly string[];
}

function stripNonSerializableFields(config: ImportJobConfig): object {
  const fields: SerializableFieldDefinition[] = config.schema.fields.map((f) => {
    const stripped: SerializableFieldDefinition = {
      name: f.name,
      type: f.type,
      required: f.required,
    };
    const result: Record<string, unknown> = { ...stripped };
    if (f.defaultValue !== undefined) result['defaultValue'] = f.defaultValue;
    if (f.separator !== undefined) result['separator'] = f.separator;
    if (f.aliases !== undefined) result['aliases'] = f.aliases;
    return result as unknown as SerializableFieldDefinition;
  });

  return {
    ...config,
    schema: {
      ...config.schema,
      fields,
    },
  };
}

export function toRow(state: ImportJobState): JobRow {
  return {
    id: state.id,
    status: state.status,
    config: stripNonSerializableFields(state.config),
    batches: state.batches.map((b) => ({
      id: b.id,
      index: b.index,
      status: b.status,
      records: [],
      processedCount: b.processedCount,
      failedCount: b.failedCount,
    })),
    totalRecords: state.totalRecords,
    startedAt: state.startedAt ?? null,
    completedAt: state.completedAt ?? null,
    distributed: state.distributed ?? false,
  };
}

export function toDomain(row: JobRow): ImportJobState {
  const config = parseJson(row.config) as ImportJobConfig;
  const batches = parseJson(row.batches) as ImportJobState['batches'];

  const base: ImportJobState = {
    id: row.id,
    config,
    status: row.status as ImportJobState['status'],
    batches,
    totalRecords: row.totalRecords,
  };

  const result = { ...base };

  if (row.startedAt !== null) {
    (result as Record<string, unknown>)['startedAt'] = Number(row.startedAt);
  }
  if (row.completedAt !== null) {
    (result as Record<string, unknown>)['completedAt'] = Number(row.completedAt);
  }
  if (row.distributed) {
    (result as Record<string, unknown>)['distributed'] = true;
  }

  return result;
}
