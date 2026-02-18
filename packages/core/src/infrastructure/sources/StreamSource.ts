import type { DataSource, SourceMetadata } from '../../domain/ports/DataSource.js';

export interface StreamSourceOptions {
  /** File name for metadata. Default: 'stream-input'. */
  readonly fileName?: string;
  /** MIME type for metadata. Default: 'text/plain'. */
  readonly mimeType?: string;
  /** File size in bytes for metadata (if known). */
  readonly fileSize?: number;
  /** Encoding for converting Buffer chunks to string. Default: 'utf-8'. */
  readonly encoding?: BufferEncoding;
}

/** Data source that wraps an `AsyncIterable` or `ReadableStream`. Ideal for Express/Fastify uploads. */
export class StreamSource implements DataSource {
  private readonly stream: AsyncIterable<string | Buffer> | ReadableStream<string | Buffer>;
  private readonly meta: SourceMetadata;
  private readonly encoding: BufferEncoding;
  private consumed = false;

  constructor(stream: AsyncIterable<string | Buffer> | ReadableStream<string | Buffer>, options?: StreamSourceOptions) {
    this.stream = stream;
    this.encoding = options?.encoding ?? 'utf-8';
    this.meta = {
      fileName: options?.fileName ?? 'stream-input',
      fileSize: options?.fileSize,
      mimeType: options?.mimeType ?? 'text/plain',
    };
  }

  async *read(): AsyncIterable<string> {
    if (this.consumed) {
      throw new Error('StreamSource: stream has already been consumed. Streams can only be read once.');
    }
    this.consumed = true;

    const iterable = this.isReadableStream(this.stream) ? this.fromReadableStream(this.stream) : this.stream;

    for await (const chunk of iterable) {
      yield typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(this.encoding);
    }
  }

  async sample(maxBytes?: number): Promise<string> {
    const chunks: string[] = [];
    let totalBytes = 0;

    for await (const chunk of this.read()) {
      chunks.push(chunk);
      totalBytes += Buffer.byteLength(chunk, this.encoding);

      if (maxBytes && totalBytes >= maxBytes) {
        const joined = chunks.join('');
        return joined.slice(0, maxBytes);
      }
    }

    return chunks.join('');
  }

  metadata(): SourceMetadata {
    return this.meta;
  }

  private isReadableStream(
    stream: AsyncIterable<string | Buffer> | ReadableStream<string | Buffer>,
  ): stream is ReadableStream<string | Buffer> {
    return typeof (stream as ReadableStream).getReader === 'function';
  }

  private async *fromReadableStream(stream: ReadableStream<string | Buffer>): AsyncIterable<string | Buffer> {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
