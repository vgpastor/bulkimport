export interface SourceMetadata {
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly mimeType?: string;
}

export interface DataSource {
  read(): AsyncIterable<string | Buffer>;
  sample(maxBytes?: number): Promise<string | Buffer>;
  metadata(): SourceMetadata;
}
