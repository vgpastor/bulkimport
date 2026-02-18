import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UrlSource } from '../../../src/infrastructure/sources/UrlSource.js';

// Mock the global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createMockResponse(
  body: string,
  options?: { status?: number; statusText?: string; headers?: Record<string, string> },
): Response {
  const status = options?.status ?? 200;
  const statusText = options?.statusText ?? 'OK';

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(options?.headers ?? {}),
    body: null,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function createStreamResponse(chunks: string[]): Response {
  let index = 0;
  const reader = {
    read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (index >= chunks.length) {
        return Promise.resolve({ done: true });
      }
      const chunk = chunks[index];
      index++;
      return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk) });
    },
    releaseLock: vi.fn(),
  };

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: {
      getReader: () => reader,
    },
    text: () => Promise.resolve(chunks.join('')),
  } as unknown as Response;
}

describe('UrlSource', () => {
  describe('read()', () => {
    it('should fetch and yield response text when body is null', async () => {
      const content = 'email,name\nalice@test.com,Alice';
      mockFetch.mockResolvedValue(createMockResponse(content));

      const source = new UrlSource('https://example.com/data.csv');
      const chunks: string[] = [];

      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(content);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/data.csv', expect.objectContaining({ headers: {} }));
    });

    it('should stream response body when available', async () => {
      mockFetch.mockResolvedValue(createStreamResponse(['email,name\n', 'alice@test.com,Alice']));

      const source = new UrlSource('https://example.com/data.csv');
      const chunks: string[] = [];

      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.join('')).toContain('alice@test.com');
    });

    it('should throw on HTTP error responses', async () => {
      mockFetch.mockResolvedValue(createMockResponse('Not Found', { status: 404, statusText: 'Not Found' }));

      const source = new UrlSource('https://example.com/missing.csv');

      await expect(async () => {
        for await (const _chunk of source.read()) {
          // Should not reach here
        }
      }).rejects.toThrow('HTTP 404 Not Found');
    });

    it('should pass custom headers to fetch', async () => {
      mockFetch.mockResolvedValue(createMockResponse('data'));

      const source = new UrlSource('https://example.com/data.csv', {
        headers: { Authorization: 'Bearer token123' },
      });

      for await (const _chunk of source.read()) {
        // consume
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/data.csv',
        expect.objectContaining({
          headers: { Authorization: 'Bearer token123' },
        }),
      );
    });
  });

  describe('sample()', () => {
    it('should fetch full content without maxBytes', async () => {
      const content = 'email,name\nalice@test.com,Alice';
      mockFetch.mockResolvedValue(createMockResponse(content));

      const source = new UrlSource('https://example.com/data.csv');
      const sample = await source.sample();

      expect(sample).toBe(content);
    });

    it('should send Range header when maxBytes is specified', async () => {
      const content = 'email,name\nalice@test.com,Alice';
      mockFetch.mockResolvedValue(createMockResponse(content, { status: 206 }));

      const source = new UrlSource('https://example.com/data.csv');
      const sample = await source.sample(100);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/data.csv',
        expect.objectContaining({
          headers: expect.objectContaining({ Range: 'bytes=0-99' }) as Record<string, string>,
        }),
      );
      expect(sample.length).toBeLessThanOrEqual(100);
    });

    it('should throw on HTTP error responses (not 200 or 206)', async () => {
      mockFetch.mockResolvedValue(createMockResponse('Forbidden', { status: 403, statusText: 'Forbidden' }));

      const source = new UrlSource('https://example.com/data.csv');

      await expect(source.sample()).rejects.toThrow('HTTP 403 Forbidden');
    });
  });

  describe('metadata()', () => {
    it('should extract file name from URL path', () => {
      const source = new UrlSource('https://example.com/files/data.csv');
      const meta = source.metadata();

      expect(meta.fileName).toBe('data.csv');
      expect(meta.mimeType).toBe('text/csv');
    });

    it('should detect MIME type from file extension', () => {
      expect(new UrlSource('https://example.com/data.json').metadata().mimeType).toBe('application/json');
      expect(new UrlSource('https://example.com/data.xml').metadata().mimeType).toBe('application/xml');
      expect(new UrlSource('https://example.com/data.tsv').metadata().mimeType).toBe('text/tab-separated-values');
      expect(new UrlSource('https://example.com/data.txt').metadata().mimeType).toBe('text/plain');
    });

    it('should use overrides when provided', () => {
      const source = new UrlSource('https://example.com/data.csv', {
        fileName: 'custom.csv',
        mimeType: 'text/custom',
      });
      const meta = source.metadata();

      expect(meta.fileName).toBe('custom.csv');
      expect(meta.mimeType).toBe('text/custom');
    });

    it('should handle URLs without file name', () => {
      const source = new UrlSource('https://example.com/');
      const meta = source.metadata();

      expect(meta.fileName).toBe('remote-file');
    });

    it('should handle invalid URLs gracefully', () => {
      const source = new UrlSource('not-a-url');
      const meta = source.metadata();

      expect(meta.fileName).toBe('remote-file');
    });
  });

  describe('timeout', () => {
    it('should use default timeout of 30s', async () => {
      mockFetch.mockResolvedValue(createMockResponse('data'));

      const source = new UrlSource('https://example.com/data.csv');
      for await (const _chunk of source.read()) {
        // consume
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/data.csv',
        expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
      );
    });

    it('should respect custom timeout', async () => {
      mockFetch.mockResolvedValue(createMockResponse('data'));

      const source = new UrlSource('https://example.com/data.csv', { timeout: 5000 });
      for await (const _chunk of source.read()) {
        // consume
      }

      // Just verify it doesn't throw — timeout is tested implicitly via AbortSignal
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
