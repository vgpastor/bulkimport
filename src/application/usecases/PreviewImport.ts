import type { PreviewResult } from '../../domain/model/ImportJob.js';
import type { ProcessedRecord } from '../../domain/model/Record.js';
import { createPendingRecord, markRecordValid, markRecordInvalid } from '../../domain/model/Record.js';
import type { ImportJobContext } from '../ImportJobContext.js';

/** Use case: validate a sample of records without processing them. */
export class PreviewImport {
  constructor(private readonly ctx: ImportJobContext) {}

  async execute(maxRecords = 10): Promise<PreviewResult> {
    this.ctx.assertSourceConfigured();
    this.ctx.transitionTo('PREVIEWING');

    const records = await this.parseRecords(maxRecords);
    const validRecords: ProcessedRecord[] = [];
    const invalidRecords: ProcessedRecord[] = [];
    const columns = new Set<string>();

    for (const record of records) {
      if (this.ctx.validator.skipEmptyRows && this.ctx.validator.isEmptyRow(record.raw)) {
        continue;
      }
      const aliased = this.ctx.validator.resolveAliases(record.raw);
      for (const key of Object.keys(aliased)) {
        columns.add(key);
      }
      const transformed = this.ctx.validator.applyTransforms(aliased);
      const result = this.ctx.validator.validate(transformed);

      if (result.isValid) {
        validRecords.push(markRecordValid(record, transformed));
      } else {
        invalidRecords.push(markRecordInvalid(record, result.errors));
      }
    }

    this.ctx.transitionTo('PREVIEWED');

    return {
      validRecords,
      invalidRecords,
      totalSampled: records.length,
      columns: [...columns],
    };
  }

  private async parseRecords(maxRecords?: number): Promise<ProcessedRecord[]> {
    const source = this.ctx.source;
    const parser = this.ctx.parser;
    if (!source || !parser) {
      throw new Error('Source and parser must be configured. Call .from(source, parser) first.');
    }

    const records: ProcessedRecord[] = [];
    let index = 0;

    for await (const chunk of source.read()) {
      for await (const raw of parser.parse(chunk)) {
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
