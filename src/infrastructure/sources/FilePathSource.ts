import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { DataSource, SourceMetadata } from '../../domain/ports/DataSource.js';
import { detectMimeType } from '../detectMimeType.js';

export interface FilePathSourceOptions {
  /** Encoding for reading the file. Default: 'utf-8'. */
  readonly encoding?: BufferEncoding;
  /** Chunk size in bytes for streaming reads. Default: 65536 (64KB). */
  readonly highWaterMark?: number;
}

/** Data source that streams from a local file path using `createReadStream`. Node.js only. */
export class FilePathSource implements DataSource {
  private readonly filePath: string;
  private readonly encoding: BufferEncoding;
  private readonly highWaterMark: number;

  constructor(filePath: string, options?: FilePathSourceOptions) {
    this.filePath = filePath;
    this.encoding = options?.encoding ?? 'utf-8';
    this.highWaterMark = options?.highWaterMark ?? 65536;
  }

  async *read(): AsyncIterable<string> {
    const stream = createReadStream(this.filePath, {
      encoding: this.encoding,
      highWaterMark: this.highWaterMark,
    });

    for await (const chunk of stream) {
      yield chunk as string;
    }
  }

  async sample(maxBytes?: number): Promise<string> {
    if (maxBytes) {
      const buffer = Buffer.alloc(maxBytes);
      const { createReadStream: crs } = await import('node:fs');
      const stream = crs(this.filePath, { end: maxBytes - 1 });
      let offset = 0;

      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, this.encoding);
        buf.copy(buffer, offset);
        offset += buf.length;
        if (offset >= maxBytes) break;
      }

      return buffer.subarray(0, offset).toString(this.encoding);
    }

    return readFile(this.filePath, { encoding: this.encoding });
  }

  metadata(): SourceMetadata {
    const stats = statSync(this.filePath);
    return {
      fileName: basename(this.filePath),
      fileSize: stats.size,
      mimeType: this.detectMimeType(),
    };
  }

  private detectMimeType(): string {
    return detectMimeType(this.filePath);
  }
}
