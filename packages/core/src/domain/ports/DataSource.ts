/** Metadata about the data source (optional, for logging and content-type detection). */
export interface SourceMetadata {
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly mimeType?: string;
}

/**
 * Port for reading data from any origin (file, buffer, HTTP, stream).
 *
 * Implementations must provide a streaming `read()` method and a `sample()` method
 * for preview. The `sample()` method accepts `maxBytes` (not `maxRecords`) because
 * the source layer operates on raw bytes before parsing — record boundaries are
 * unknown at this level. The parser is responsible for extracting records from the
 * sampled bytes.
 */
export interface DataSource {
  /** Yield data chunks as strings or Buffers for lazy/streaming consumption. */
  read(): AsyncIterable<string | Buffer>;
  /** Return a small chunk of raw data (up to `maxBytes`) for preview and format detection. */
  sample(maxBytes?: number): Promise<string | Buffer>;
  /** Return metadata about the source (file name, size, MIME type). */
  metadata(): SourceMetadata;
}
