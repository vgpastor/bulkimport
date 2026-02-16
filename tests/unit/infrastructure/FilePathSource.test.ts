import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilePathSource } from '../../../src/infrastructure/sources/FilePathSource.js';

const TEST_DIR = join(tmpdir(), 'bulkimport-test-filepathsource');

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTempFile(name: string, content: string): string {
  const filePath = join(TEST_DIR, name);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('FilePathSource', () => {
  describe('read()', () => {
    it('should stream file content as chunks', async () => {
      const filePath = writeTempFile('read-basic.csv', 'email,name\nalice@test.com,Alice\n');
      const source = new FilePathSource(filePath);

      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      const content = chunks.join('');
      expect(content).toContain('email,name');
      expect(content).toContain('alice@test.com');
    });

    it('should stream large content in multiple chunks', async () => {
      const line = 'user@test.com,Test User,30\n';
      const header = 'email,name,age\n';
      const content = header + line.repeat(5000);
      const filePath = writeTempFile('read-large.csv', content);

      // Use small highWaterMark to force multiple chunks
      const source = new FilePathSource(filePath, { highWaterMark: 256 });

      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(content);
    });
  });

  describe('sample()', () => {
    it('should return full content without maxBytes', async () => {
      const filePath = writeTempFile('sample-full.csv', 'email,name\nalice@test.com,Alice\n');
      const source = new FilePathSource(filePath);

      const sample = await source.sample();
      expect(sample).toContain('alice@test.com');
    });

    it('should return limited content with maxBytes', async () => {
      const filePath = writeTempFile('sample-limited.csv', 'email,name\nalice@test.com,Alice\n');
      const source = new FilePathSource(filePath);

      const sample = await source.sample(10);
      expect(sample.length).toBeLessThanOrEqual(10);
    });
  });

  describe('metadata()', () => {
    it('should return file name and size', () => {
      const content = 'email,name\nalice@test.com,Alice\n';
      const filePath = writeTempFile('meta.csv', content);
      const source = new FilePathSource(filePath);

      const meta = source.metadata();
      expect(meta.fileName).toBe('meta.csv');
      expect(meta.fileSize).toBe(Buffer.byteLength(content));
    });

    it('should detect CSV mime type', () => {
      const filePath = writeTempFile('detect.csv', 'a,b\n1,2');
      const source = new FilePathSource(filePath);
      expect(source.metadata().mimeType).toBe('text/csv');
    });

    it('should detect JSON mime type', () => {
      const filePath = writeTempFile('detect.json', '[]');
      const source = new FilePathSource(filePath);
      expect(source.metadata().mimeType).toBe('application/json');
    });

    it('should default to text/plain for unknown extensions', () => {
      const filePath = writeTempFile('detect.xyz', 'data');
      const source = new FilePathSource(filePath);
      expect(source.metadata().mimeType).toBe('text/plain');
    });
  });

  describe('integration with BulkImport pipeline', () => {
    it('should work as DataSource in full import', async () => {
      const { BulkImport } = await import('../../../src/BulkImport.js');
      const { CsvParser } = await import('../../../src/infrastructure/parsers/CsvParser.js');

      const content = 'email,name,age\nalice@test.com,Alice,30\nbob@test.com,Bob,25\n';
      const filePath = writeTempFile('integration.csv', content);

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

      importer.from(new FilePathSource(filePath), new CsvParser());

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
