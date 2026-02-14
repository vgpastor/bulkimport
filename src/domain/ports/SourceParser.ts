import type { RawRecord } from '../model/Record.js';

export interface ParserOptions {
  readonly delimiter?: string;
  readonly encoding?: string;
  readonly hasHeader?: boolean;
}

export interface SourceParser {
  parse(data: string | Buffer): AsyncIterable<RawRecord> | Iterable<RawRecord>;
  detect?(sample: string | Buffer): ParserOptions;
}
