import { describe, it, expect } from 'vitest';
import { StreamSource } from '../../../src/infrastructure/sources/StreamSource.js';

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (i >= items.length) return Promise.resolve({ done: true as const, value: undefined });
          return Promise.resolve({ done: false as const, value: items[i++]! });
        },
      };
    },
  };
}

describe('StreamSource', () => {
  describe('read()', () => {
    it('should yield string chunks from AsyncIterable', async () => {
      const source = new StreamSource(createAsyncIterable(['hello', ' world']));

      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['hello', ' world']);
    });

    it('should convert Buffer chunks to strings', async () => {
      const buffers = [Buffer.from('email,name\n'), Buffer.from('alice@test.com,Alice\n')];
      const source = new StreamSource(createAsyncIterable(buffers));

      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      expect(chunks.join('')).toBe('email,name\nalice@test.com,Alice\n');
    });

    it('should throw when read twice', async () => {
      const source = new StreamSource(createAsyncIterable(['data']));

      // First read — consumes
      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      // Second read — should throw
      await expect(async () => {
        for await (const _ of source.read()) {
          // consume
        }
      }).rejects.toThrow('already been consumed');
    });
  });

  describe('sample()', () => {
    it('should return full content without maxBytes', async () => {
      const source = new StreamSource(createAsyncIterable(['hello', ' world']));
      const sample = await source.sample();
      expect(sample).toBe('hello world');
    });

    it('should return limited content with maxBytes', async () => {
      const source = new StreamSource(createAsyncIterable(['hello world, this is a long string']));
      const sample = await source.sample(5);
      expect(sample).toBe('hello');
    });
  });

  describe('metadata()', () => {
    it('should return default metadata', () => {
      const source = new StreamSource(createAsyncIterable<string>([]));
      const meta = source.metadata();

      expect(meta.fileName).toBe('stream-input');
      expect(meta.mimeType).toBe('text/plain');
      expect(meta.fileSize).toBeUndefined();
    });

    it('should return custom metadata', () => {
      const source = new StreamSource(createAsyncIterable<string>([]), {
        fileName: 'upload.csv',
        mimeType: 'text/csv',
        fileSize: 1024,
      });
      const meta = source.metadata();

      expect(meta.fileName).toBe('upload.csv');
      expect(meta.mimeType).toBe('text/csv');
      expect(meta.fileSize).toBe(1024);
    });
  });

  describe('ReadableStream input', () => {
    it('should yield string chunks from a ReadableStream', async () => {
      const readable = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('chunk1');
          controller.enqueue('chunk2');
          controller.close();
        },
      });

      const source = new StreamSource(readable);
      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('should convert Buffer chunks from a ReadableStream', async () => {
      const readable = new ReadableStream<Buffer>({
        start(controller) {
          controller.enqueue(Buffer.from('hello '));
          controller.enqueue(Buffer.from('world'));
          controller.close();
        },
      });

      const source = new StreamSource(readable);
      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      expect(chunks.join('')).toBe('hello world');
    });

    it('should throw when ReadableStream is read twice', async () => {
      const readable = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('data');
          controller.close();
        },
      });

      const source = new StreamSource(readable);

      for await (const _ of source.read()) {
        // consume
      }

      await expect(async () => {
        for await (const _ of source.read()) {
          // should throw
        }
      }).rejects.toThrow('already been consumed');
    });
  });

  describe('integration with BulkImport pipeline', () => {
    it('should work as DataSource in full import', async () => {
      const { BulkImport } = await import('../../../src/BulkImport.js');
      const { CsvParser } = await import('../../../src/infrastructure/parsers/CsvParser.js');

      const csv = 'email,name,age\nalice@test.com,Alice,30\nbob@test.com,Bob,25\n';
      const source = new StreamSource(createAsyncIterable([csv]), {
        fileName: 'upload.csv',
        mimeType: 'text/csv',
      });

      const importer = new BulkImport({
        schema: {
          fields: [
            { name: 'email', type: 'email', required: true },
            { name: 'name', type: 'string', required: true },
            { name: 'age', type: 'number', required: false },
          ],
        },
        batchSize: 10,
      });

      importer.from(source, new CsvParser());

      const processed: Record<string, unknown>[] = [];
      await importer.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      expect(processed).toHaveLength(2);
      const status = importer.getStatus();
      expect(status.status).toBe('COMPLETED');
      expect(status.progress.percentage).toBe(100);
    });
  });
});
