import type { JobState, JobConfig } from '@batchactions/core';
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

function stripNonSerializableFields(config: JobConfig): object {
  if (!config.schema) return config;

  const schema = config.schema as { fields?: readonly Record<string, unknown>[] };
  if (!schema.fields || !Array.isArray(schema.fields)) return config;

  const rawFields: readonly Record<string, unknown>[] = schema.fields;
  const fields: SerializableFieldDefinition[] = rawFields.map((f) => {
    const name = typeof f['name'] === 'string' ? f['name'] : '';
    const type = typeof f['type'] === 'string' ? f['type'] : '';
    const required = typeof f['required'] === 'boolean' ? f['required'] : false;
    const result: Record<string, unknown> = { name, type, required };
    if (f['defaultValue'] !== undefined) result['defaultValue'] = f['defaultValue'];
    if (f['separator'] !== undefined) result['separator'] = f['separator'];
    if (f['aliases'] !== undefined) result['aliases'] = f['aliases'];
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

export function toRow(state: JobState): JobRow {
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

export function toDomain(row: JobRow): JobState {
  const config = parseJson(row.config) as JobConfig;
  const batches = parseJson(row.batches) as JobState['batches'];

  const base: JobState = {
    id: row.id,
    config,
    status: row.status as JobState['status'],
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
