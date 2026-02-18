import { describe, it, expect } from 'vitest';
import { XmlParser } from '../../../src/infrastructure/parsers/XmlParser.js';

describe('XmlParser', () => {
  describe('basic parsing', () => {
    it('should parse a simple XML with explicit recordTag', () => {
      const xml = `
        <people>
          <person>
            <email>alice@test.com</email>
            <name>Alice</name>
          </person>
          <person>
            <email>bob@test.com</email>
            <name>Bob</name>
          </person>
        </people>
      `;

      const parser = new XmlParser({ recordTag: 'person' });
      const records = [...parser.parse(xml)];

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({ email: 'alice@test.com', name: 'Alice' });
      expect(records[1]).toEqual({ email: 'bob@test.com', name: 'Bob' });
    });

    it('should auto-detect record tag from XML structure', () => {
      const xml = `
        <records>
          <record>
            <email>alice@test.com</email>
            <name>Alice</name>
          </record>
          <record>
            <email>bob@test.com</email>
            <name>Bob</name>
          </record>
        </records>
      `;

      const parser = new XmlParser();
      const records = [...parser.parse(xml)];

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({ email: 'alice@test.com', name: 'Alice' });
    });

    it('should handle Buffer input', () => {
      const xml = `<items><item><id>1</id><name>Test</name></item></items>`;
      const parser = new XmlParser({ recordTag: 'item' });
      const records = [...parser.parse(Buffer.from(xml))];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ id: '1', name: 'Test' });
    });
  });

  describe('XML entities', () => {
    it('should decode standard XML entities', () => {
      const xml = `
        <items>
          <item>
            <name>Smith &amp; Jones</name>
            <description>&lt;b&gt;bold&lt;/b&gt;</description>
          </item>
        </items>
      `;

      const parser = new XmlParser({ recordTag: 'item' });
      const records = [...parser.parse(xml)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        name: 'Smith & Jones',
        description: '<b>bold</b>',
      });
    });

    it('should decode quote entities', () => {
      const xml = `<items><item><text>&quot;hello&quot; &apos;world&apos;</text></item></items>`;
      const parser = new XmlParser({ recordTag: 'item' });
      const records = [...parser.parse(xml)];

      expect(records[0]).toEqual({ text: '"hello" \'world\'' });
    });
  });

  describe('edge cases', () => {
    it('should return empty for empty string', () => {
      const parser = new XmlParser();
      const records = [...parser.parse('')];
      expect(records).toHaveLength(0);
    });

    it('should return empty for whitespace-only content', () => {
      const parser = new XmlParser();
      const records = [...parser.parse('   \n  ')];
      expect(records).toHaveLength(0);
    });

    it('should handle self-closing tags as empty values', () => {
      const xml = `<items><item><name>Alice</name><age/></item></items>`;
      const parser = new XmlParser({ recordTag: 'item' });
      const records = [...parser.parse(xml)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ name: 'Alice', age: '' });
    });

    it('should handle single record', () => {
      const xml = `<items><item><name>Solo</name></item></items>`;
      const parser = new XmlParser({ recordTag: 'item' });
      const records = [...parser.parse(xml)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ name: 'Solo' });
    });

    it('should throw when record tag cannot be detected and none provided', () => {
      const parser = new XmlParser();
      expect(() => [...parser.parse('<root/>')]).toThrow('could not detect record tag');
    });

    it('should handle multiple fields per record', () => {
      const xml = `
        <data>
          <row>
            <email>test@example.com</email>
            <name>Test User</name>
            <age>30</age>
            <city>Madrid</city>
          </row>
        </data>
      `;
      const parser = new XmlParser({ recordTag: 'row' });
      const records = [...parser.parse(xml)];

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        email: 'test@example.com',
        name: 'Test User',
        age: '30',
        city: 'Madrid',
      });
    });
  });

  describe('detect', () => {
    it('should return base parser options', () => {
      const parser = new XmlParser();
      const options = parser.detect('<items><item><name>Test</name></item></items>');

      expect(options.encoding).toBe('utf-8');
      expect(options.hasHeader).toBe(false);
    });
  });
});
