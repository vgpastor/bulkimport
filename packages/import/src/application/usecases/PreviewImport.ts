import type { PreviewResult } from '../../domain/model/PreviewResult.js';
import type { ProcessedRecord, DataSource } from '@batchactions/core';
import { createPendingRecord, markRecordValid, markRecordInvalid } from '@batchactions/core';
import type { SchemaValidator } from '../../domain/services/SchemaValidator.js';
import type { SourceParser } from '../../domain/ports/SourceParser.js';

/** Use case: validate a sample of records without processing them. */
export class PreviewImport {
  constructor(
    private readonly source: DataSource,
    private readonly parser: SourceParser,
    private readonly validator: SchemaValidator,
  ) {}

  async execute(maxRecords = 10): Promise<PreviewResult> {
    const records = await this.parseRecords(maxRecords);
    const validRecords: ProcessedRecord[] = [];
    const invalidRecords: ProcessedRecord[] = [];
    const columns = new Set<string>();

    for (const record of records) {
      if (this.validator.skipEmptyRows && this.validator.isEmptyRow(record.raw)) {
        continue;
      }
      const aliased = this.validator.resolveAliases(record.raw);
      for (const key of Object.keys(aliased)) {
        columns.add(key);
      }
      const transformed = this.validator.applyTransforms(aliased);
      const result = this.validator.validate(transformed);

      if (result.isValid) {
        validRecords.push(markRecordValid(record, transformed));
      } else {
        invalidRecords.push(markRecordInvalid(record, result.errors));
      }
    }

    return {
      validRecords,
      invalidRecords,
      totalSampled: records.length,
      columns: [...columns],
    };
  }

  private async parseRecords(maxRecords?: number): Promise<ProcessedRecord[]> {
    const records: ProcessedRecord[] = [];
    let index = 0;

    for await (const chunk of this.source.read()) {
      for await (const raw of this.parser.parse(chunk)) {
        if (maxRecords !== undefined && records.length >= maxRecords) {
          return records;
        }
        records.push(createPendingRecord(index, raw));
        index++;
      }
    }

    return records;
  }
}
