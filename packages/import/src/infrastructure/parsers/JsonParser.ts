import type { SourceParser, ParserOptions } from '../../domain/ports/SourceParser.js';
import type { RawRecord } from '@batchactions/core';

export interface JsonParserOptions {
  /** Parse format: 'array' for JSON array of objects, 'ndjson' for newline-delimited JSON. Default: 'auto'. */
  readonly format?: 'array' | 'ndjson' | 'auto';
}

/** JSON parser adapter supporting JSON array and NDJSON formats with auto-detection. Zero dependencies. */
export class JsonParser implements SourceParser {
  private readonly format: 'array' | 'ndjson' | 'auto';

  constructor(options?: JsonParserOptions) {
    this.format = options?.format ?? 'auto';
  }

  *parse(data: string | Buffer): Iterable<RawRecord> {
    const content = typeof data === 'string' ? data : data.toString('utf-8');
    const trimmed = content.trim();

    if (trimmed === '') return;

    const format = this.format === 'auto' ? this.detectFormat(trimmed) : this.format;

    if (format === 'array') {
      yield* this.parseArray(trimmed);
    } else {
      yield* this.parseNdjson(trimmed);
    }
  }

  detect(sample: string | Buffer): ParserOptions {
    const content = typeof sample === 'string' ? sample : sample.toString('utf-8');
    const trimmed = content.trim();
    const format = this.detectFormat(trimmed);

    return {
      encoding: 'utf-8',
      delimiter: format === 'ndjson' ? '\n' : undefined,
      hasHeader: false,
    };
  }

  private detectFormat(content: string): 'array' | 'ndjson' {
    return content.startsWith('[') ? 'array' : 'ndjson';
  }

  private *parseArray(content: string): Iterable<RawRecord> {
    const parsed: unknown = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      throw new Error('JsonParser: expected a JSON array of objects');
    }

    for (const item of parsed) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('JsonParser: each item in the array must be a plain object');
      }
      yield this.flattenValues(item as Record<string, unknown>);
    }
  }

  private *parseNdjson(content: string): Iterable<RawRecord> {
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '') continue;

      const parsed: unknown = JSON.parse(trimmedLine);

      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JsonParser: each NDJSON line must be a plain object');
      }
      yield this.flattenValues(parsed as Record<string, unknown>);
    }
  }

  private flattenValues(obj: Record<string, unknown>): RawRecord {
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      flat[key] = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    }
    return flat as RawRecord;
  }
}
