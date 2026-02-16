import { describe, it, expect } from 'vitest';
import { parseJson } from '../../src/utils/parseJson.js';

describe('parseJson', () => {
  it('should return object as-is when already parsed', () => {
    const obj = { name: 'Alice', age: 30 };
    expect(parseJson(obj)).toBe(obj);
  });

  it('should parse a JSON string into an object', () => {
    const json = '{"name":"Alice","age":30}';
    expect(parseJson(json)).toEqual({ name: 'Alice', age: 30 });
  });

  it('should parse a JSON array string', () => {
    const json = '[{"id":"b1"},{"id":"b2"}]';
    expect(parseJson(json)).toEqual([{ id: 'b1' }, { id: 'b2' }]);
  });

  it('should return array as-is when already parsed', () => {
    const arr = [1, 2, 3];
    expect(parseJson(arr)).toBe(arr);
  });

  it('should return null as-is', () => {
    expect(parseJson(null)).toBeNull();
  });

  it('should return number as-is', () => {
    expect(parseJson(42)).toBe(42);
  });
});
