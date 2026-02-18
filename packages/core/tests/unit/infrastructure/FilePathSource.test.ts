import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilePathSource } from '../../../src/infrastructure/sources/FilePathSource.js';
import type { RawRecord } from '../../../src/domain/model/Record.js';

const TEST_DIR = join(tmpdir(), 'batchactions-test-filepathsource');

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

function simpleCsvParser() {
  return {
    *parse(data: string | Buffer): Iterable<RawRecord> {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      const lines = text.split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) return;
      const headers = lines[0]!.split(',').map((h) => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i]!.split(',').map((v) => v.trim());
        const record: RawRecord = {};
        for (let j = 0; j < headers.length; j++) {
          record[headers[j]!] = values[j] ?? '';
        }
        yield record;
      }
    },
  };
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

  describe('integration with BatchEngine pipeline', () => {
    it('should work as DataSource in full processing', async () => {
      const { BatchEngine } = await import('../../../src/BatchEngine.js');

      const content = 'email,name,age\nalice@test.com,Alice,30\nbob@test.com,Bob,25\n';
      const filePath = writeTempFile('integration.csv', content);

      const engine = new BatchEngine({
        batchSize: 10,
      });

      engine.from(new FilePathSource(filePath), simpleCsvParser());

      const processed: Record<string, unknown>[] = [];
      await engine.start(async (record) => {
        processed.push(record);
        await Promise.resolve();
      });

      expect(processed).toHaveLength(2);
      const status = engine.getStatus();
      expect(status.status).toBe('COMPLETED');
      expect(status.progress.percentage).toBe(100);
    });
  });
});
