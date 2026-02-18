import { describe, it, expect } from 'vitest';
import { JsonParser } from '../../../src/infrastructure/parsers/JsonParser.js';

describe('JsonParser', () => {
  describe('JSON array format', () => {
    it('should parse a JSON array of objects', () => {
      const data = JSON.stringify([
        { email: 'alice@test.com', name: 'Alice', age: 30 },
        { email: 'bob@test.com', name: 'Bob', age: 25 },
      ]);

      const parser = new JsonParser();
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({ email: 'alice@test.com', name: 'Alice', age: 30 });
      expect(records[1]).toEqual({ email: 'bob@test.com', name: 'Bob', age: 25 });
    });

    it('should parse a JSON array with explicit format option', () => {
      const data = JSON.stringify([{ name: 'Alice' }]);
      const parser = new JsonParser({ format: 'array' });
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ name: 'Alice' });
    });

    it('should return empty for empty array', () => {
      const parser = new JsonParser();
      const records = [...parser.parse('[]')];

      expect(records).toHaveLength(0);
    });

    it('should return empty for empty string', () => {
      const parser = new JsonParser();
      const records = [...parser.parse('')];

      expect(records).toHaveLength(0);
    });

    it('should return empty for whitespace-only string', () => {
      const parser = new JsonParser();
      const records = [...parser.parse('   \n  ')];

      expect(records).toHaveLength(0);
    });

    it('should throw for non-array JSON', () => {
      const parser = new JsonParser({ format: 'array' });

      expect(() => [...parser.parse('{"key": "value"}')]).toThrow('expected a JSON array');
    });

    it('should throw for array with non-object items', () => {
      const parser = new JsonParser();

      expect(() => [...parser.parse('[1, 2, 3]')]).toThrow('each item in the array must be a plain object');
    });

    it('should throw for array with null items', () => {
      const parser = new JsonParser();

      expect(() => [...parser.parse('[null]')]).toThrow('each item in the array must be a plain object');
    });

    it('should flatten nested objects to JSON strings', () => {
      const data = JSON.stringify([{ name: 'Alice', address: { city: 'Madrid', zip: '28001' } }]);

      const parser = new JsonParser();
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        name: 'Alice',
        address: '{"city":"Madrid","zip":"28001"}',
      });
    });

    it('should handle null values in fields', () => {
      const data = JSON.stringify([{ name: 'Alice', age: null }]);
      const parser = new JsonParser();
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ name: 'Alice', age: null });
    });
  });

  describe('NDJSON format', () => {
    it('should parse newline-delimited JSON', () => {
      const data = '{"email":"alice@test.com","name":"Alice"}\n{"email":"bob@test.com","name":"Bob"}';

      const parser = new JsonParser();
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({ email: 'alice@test.com', name: 'Alice' });
      expect(records[1]).toEqual({ email: 'bob@test.com', name: 'Bob' });
    });

    it('should parse NDJSON with explicit format option', () => {
      const data = '{"name":"Alice"}\n{"name":"Bob"}';
      const parser = new JsonParser({ format: 'ndjson' });
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(2);
    });

    it('should skip empty lines in NDJSON', () => {
      const data = '{"name":"Alice"}\n\n{"name":"Bob"}\n';

      const parser = new JsonParser();
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(2);
    });

    it('should throw for non-object NDJSON lines', () => {
      const parser = new JsonParser({ format: 'ndjson' });

      expect(() => [...parser.parse('"just a string"')]).toThrow('each NDJSON line must be a plain object');
    });

    it('should flatten nested objects in NDJSON', () => {
      const data = '{"name":"Alice","meta":{"role":"admin"}}';

      const parser = new JsonParser();
      const records = [...parser.parse(data)];

      expect(records[0]).toEqual({
        name: 'Alice',
        meta: '{"role":"admin"}',
      });
    });
  });

  describe('auto-detection', () => {
    it('should auto-detect array format when content starts with [', () => {
      const data = '[{"name":"Alice"}]';
      const parser = new JsonParser({ format: 'auto' });
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(1);
    });

    it('should auto-detect NDJSON format when content starts with {', () => {
      const data = '{"name":"Alice"}\n{"name":"Bob"}';
      const parser = new JsonParser({ format: 'auto' });
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(2);
    });

    it('should use auto format by default', () => {
      const parser = new JsonParser();
      const arrayRecords = [...parser.parse('[{"a":1}]')];
      const ndjsonRecords = [...parser.parse('{"a":1}\n{"b":2}')];

      expect(arrayRecords).toHaveLength(1);
      expect(ndjsonRecords).toHaveLength(2);
    });
  });

  describe('detect()', () => {
    it('should detect array format', () => {
      const parser = new JsonParser();
      const options = parser.detect('[{"name":"Alice"}]');

      expect(options.hasHeader).toBe(false);
      expect(options.delimiter).toBeUndefined();
    });

    it('should detect NDJSON format', () => {
      const parser = new JsonParser();
      const options = parser.detect('{"name":"Alice"}');

      expect(options.hasHeader).toBe(false);
      expect(options.delimiter).toBe('\n');
    });
  });

  describe('Buffer input', () => {
    it('should parse Buffer input', () => {
      const data = Buffer.from(JSON.stringify([{ name: 'Alice' }]));
      const parser = new JsonParser();
      const records = [...parser.parse(data)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ name: 'Alice' });
    });
  });
});
