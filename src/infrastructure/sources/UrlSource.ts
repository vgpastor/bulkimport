import type { DataSource, SourceMetadata } from '../../domain/ports/DataSource.js';

export interface UrlSourceOptions {
  /** Custom HTTP headers to send with the request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request timeout in milliseconds. Default: `30000` (30 seconds). */
  readonly timeout?: number;
  /** File name for metadata. Default: extracted from URL path. */
  readonly fileName?: string;
  /** MIME type override. Default: extracted from Content-Type response header. */
  readonly mimeType?: string;
}

/**
 * Data source that fetches data from a URL using the Fetch API.
 *
 * Streams the response body for memory-efficient processing of large remote files.
 * Requires a runtime with global `fetch` (Node.js >= 18, browsers, Deno, Bun).
 */
export class UrlSource implements DataSource {
  private readonly url: string;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly timeout: number;
  private readonly fileNameOverride: string | undefined;
  private readonly mimeTypeOverride: string | undefined;

  constructor(url: string, options?: UrlSourceOptions) {
    this.url = url;
    this.headers = options?.headers ?? {};
    this.timeout = options?.timeout ?? 30000;
    this.fileNameOverride = options?.fileName;
    this.mimeTypeOverride = options?.mimeType;
  }

  async *read(): AsyncIterable<string> {
    const response = await this.fetchWithTimeout();

    if (!response.ok) {
      throw new Error(`UrlSource: HTTP ${String(response.status)} ${response.statusText} for ${this.url}`);
    }

    if (!response.body) {
      const text = await response.text();
      yield text;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
      // Flush remaining bytes
      const final = decoder.decode();
      if (final) yield final;
    } finally {
      reader.releaseLock();
    }
  }

  async sample(maxBytes?: number): Promise<string> {
    const headers: Record<string, string> = { ...this.headers };

    if (maxBytes) {
      headers['Range'] = `bytes=0-${String(maxBytes - 1)}`;
    }

    const response = await this.fetchWithTimeout(headers);

    if (!response.ok && response.status !== 206) {
      throw new Error(`UrlSource: HTTP ${String(response.status)} ${response.statusText} for ${this.url}`);
    }

    const text = await response.text();
    return maxBytes ? text.slice(0, maxBytes) : text;
  }

  metadata(): SourceMetadata {
    return {
      fileName: this.fileNameOverride ?? this.extractFileName(),
      mimeType: this.mimeTypeOverride ?? this.detectMimeType(),
    };
  }

  private async fetchWithTimeout(headerOverrides?: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeout);

    try {
      return await fetch(this.url, {
        headers: { ...this.headers, ...headerOverrides },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractFileName(): string {
    try {
      const urlObj = new URL(this.url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/');
      const last = segments[segments.length - 1];
      return last && last.length > 0 ? decodeURIComponent(last) : 'remote-file';
    } catch {
      return 'remote-file';
    }
  }

  private detectMimeType(): string {
    const fileName = this.extractFileName();
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'csv':
        return 'text/csv';
      case 'json':
        return 'application/json';
      case 'xml':
        return 'application/xml';
      case 'tsv':
        return 'text/tab-separated-values';
      default:
        return 'text/plain';
    }
  }
}
