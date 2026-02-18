import Papa from 'papaparse';
import type { SourceParser, ParserOptions } from '../../domain/ports/SourceParser.js';
import type { RawRecord } from '@batchactions/core';
import { isEmptyRow } from '@batchactions/core';

/** CSV parser adapter using PapaParse. Supports auto-delimiter detection and header mapping. */
export class CsvParser implements SourceParser {
  private readonly options: ParserOptions;

  constructor(options?: Partial<ParserOptions>) {
    this.options = {
      delimiter: options?.delimiter,
      encoding: options?.encoding ?? 'utf-8',
      hasHeader: options?.hasHeader ?? true,
    };
  }

  *parse(data: string | Buffer): Iterable<RawRecord> {
    const content = typeof data === 'string' ? data : data.toString('utf-8');

    const result = Papa.parse(content, {
      header: this.options.hasHeader,
      delimiter: this.options.delimiter || undefined,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    for (const row of result.data as Record<string, unknown>[]) {
      if (isEmptyRow(row as RawRecord)) continue;
      yield row as RawRecord;
    }
  }

  detect(sample: string | Buffer): ParserOptions {
    const content = typeof sample === 'string' ? sample : sample.toString('utf-8');
    const firstLines = content.split('\n').slice(0, 5).join('\n');

    const delimiters = [',', ';', '\t', '|'];
    let bestDelimiter = ',';
    let maxColumns = 0;

    for (const delimiter of delimiters) {
      const result = Papa.parse(firstLines, { delimiter, header: false });
      const firstRow = result.data[0] as string[] | undefined;
      if (firstRow && firstRow.length > maxColumns) {
        maxColumns = firstRow.length;
        bestDelimiter = delimiter;
      }
    }

    return {
      delimiter: bestDelimiter,
      encoding: 'utf-8',
      hasHeader: true,
    };
  }
}
