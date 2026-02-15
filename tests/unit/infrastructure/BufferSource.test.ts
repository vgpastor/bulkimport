import { describe, it, expect } from 'vitest';
import { BufferSource } from '../../../src/infrastructure/sources/BufferSource.js';

describe('BufferSource', () => {
  describe('constructor', () => {
    it('should accept a string', async () => {
      const source = new BufferSource('hello world');
      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }
      expect(chunks.join('')).toBe('hello world');
    });

    it('should accept a Buffer', async () => {
      const source = new BufferSource(Buffer.from('hello buffer'));
      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }
      expect(chunks.join('')).toBe('hello buffer');
    });

    it('should use custom metadata when provided', () => {
      const source = new BufferSource('data', {
        fileName: 'custom.csv',
        mimeType: 'text/csv',
        fileSize: 999,
      });
      const meta = source.metadata();
      expect(meta.fileName).toBe('custom.csv');
      expect(meta.mimeType).toBe('text/csv');
      // fileSize is computed from content length, not from metadata
      expect(meta.fileSize).toBe(4);
    });

    it('should use default metadata when not provided', () => {
      const source = new BufferSource('some data');
      const meta = source.metadata();
      expect(meta.fileName).toBe('buffer-input');
      expect(meta.mimeType).toBe('text/plain');
      expect(meta.fileSize).toBe(9);
    });
  });

  describe('sample()', () => {
    it('should return full content without maxBytes', async () => {
      const source = new BufferSource('full content here');
      const sample = await source.sample();
      expect(sample).toBe('full content here');
    });

    it('should return truncated content with maxBytes', async () => {
      const source = new BufferSource('long string of data');
      const sample = await source.sample(4);
      expect(sample).toBe('long');
    });

    it('should return full content when maxBytes exceeds length', async () => {
      const source = new BufferSource('short');
      const sample = await source.sample(100);
      expect(sample).toBe('short');
    });
  });

  describe('read()', () => {
    it('should yield a single chunk with the full content', async () => {
      const source = new BufferSource('csv,data\nrow1,value1');
      const chunks: string[] = [];
      for await (const chunk of source.read()) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('csv,data\nrow1,value1');
    });
  });
});
