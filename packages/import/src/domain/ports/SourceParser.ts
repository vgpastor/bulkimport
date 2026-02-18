import type { RawRecord } from '@batchactions/core';

/** Auto-detected or configured parser options. */
export interface ParserOptions {
  /** Column delimiter character (e.g. `','`, `';'`, `'\t'`). */
  readonly delimiter?: string;
  /** Character encoding of the source data. */
  readonly encoding?: string;
  /** Whether the first row contains column headers. */
  readonly hasHeader?: boolean;
}

/**
 * Port for parsing raw data into records.
 *
 * Implement this interface to support new data formats (CSV, JSON, XML, etc.).
 * The `parse()` method receives a single chunk and yields records lazily.
 */
export interface SourceParser {
  /** Parse a data chunk into an iterable of records (may be sync or async). */
  parse(data: string | Buffer): AsyncIterable<RawRecord> | Iterable<RawRecord>;
  /** Auto-detect parser options from a small sample of data. */
  detect?(sample: string | Buffer): ParserOptions;
}
