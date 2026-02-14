import type { DataSource, SourceMetadata } from '../../domain/ports/DataSource.js';

export class BufferSource implements DataSource {
  private readonly content: string;
  private readonly meta: SourceMetadata;

  constructor(data: string | Buffer, metadata?: Partial<SourceMetadata>) {
    this.content = typeof data === 'string' ? data : data.toString('utf-8');
    this.meta = {
      fileName: metadata?.fileName ?? 'buffer-input',
      fileSize: this.content.length,
      mimeType: metadata?.mimeType ?? 'text/plain',
    };
  }

  async *read(): AsyncIterable<string> {
    yield await Promise.resolve(this.content);
  }

  sample(maxBytes?: number): Promise<string> {
    if (maxBytes && maxBytes < this.content.length) {
      return Promise.resolve(this.content.slice(0, maxBytes));
    }
    return Promise.resolve(this.content);
  }

  metadata(): SourceMetadata {
    return this.meta;
  }
}
