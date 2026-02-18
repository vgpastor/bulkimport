import type { SourceParser, ParserOptions } from '../../domain/ports/SourceParser.js';
import type { RawRecord } from '@batchactions/core';

export interface XmlParserOptions {
  /** Tag name that wraps each record. Default: auto-detected from the first repeated child element. */
  readonly recordTag?: string;
}

/**
 * XML parser adapter. Zero dependencies — uses a lightweight regex-based approach
 * for flat XML structures (no nested record elements).
 *
 * Expected XML format:
 * ```xml
 * <root>
 *   <record>
 *     <email>alice@test.com</email>
 *     <name>Alice</name>
 *   </record>
 *   <record>
 *     <email>bob@test.com</email>
 *     <name>Bob</name>
 *   </record>
 * </root>
 * ```
 *
 * Each child element of the record becomes a field key. Nested elements are
 * flattened to their text content.
 */
export class XmlParser implements SourceParser {
  private readonly recordTag: string | undefined;

  constructor(options?: XmlParserOptions) {
    this.recordTag = options?.recordTag;
  }

  *parse(data: string | Buffer): Iterable<RawRecord> {
    const content = typeof data === 'string' ? data : data.toString('utf-8');
    const trimmed = content.trim();

    if (trimmed === '') return;

    const tag = this.recordTag ?? this.detectRecordTag(trimmed);
    if (!tag) {
      throw new Error('XmlParser: could not detect record tag. Provide recordTag in options.');
    }

    const recordRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
    let match: RegExpExecArray | null;

    while ((match = recordRegex.exec(trimmed)) !== null) {
      const innerXml = match[1];
      if (innerXml === undefined) continue;
      const record = this.parseRecordFields(innerXml);
      yield record;
    }
  }

  detect(_sample: string | Buffer): ParserOptions {
    return {
      encoding: 'utf-8',
      hasHeader: false,
    };
  }

  private detectRecordTag(content: string): string | null {
    const rootMatch = /<([a-zA-Z_][\w.-]*)[^>]*>/.exec(content);
    if (!rootMatch?.[1]) return null;

    const rootTag = rootMatch[1];

    const childRegex = new RegExp(`<${rootTag}[^>]*>[\\s\\S]*?<([a-zA-Z_][\\w.-]*)[^>]*>`);
    const childMatch = childRegex.exec(content);
    if (!childMatch?.[1]) return null;

    return childMatch[1];
  }

  private parseRecordFields(innerXml: string): RawRecord {
    const fields: Record<string, unknown> = {};
    const fieldRegex = /<([a-zA-Z_][\w.-]*)[^>]*>([\s\S]*?)<\/\1>/g;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRegex.exec(innerXml)) !== null) {
      const key = fieldMatch[1];
      const value = fieldMatch[2];
      if (key !== undefined && value !== undefined) {
        fields[key] = this.decodeXmlEntities(value.trim());
      }
    }

    const selfClosingRegex = /<([a-zA-Z_][\w.-]*)\s*\/>/g;
    let selfMatch: RegExpExecArray | null;

    while ((selfMatch = selfClosingRegex.exec(innerXml)) !== null) {
      const key = selfMatch[1];
      if (key !== undefined && !(key in fields)) {
        fields[key] = '';
      }
    }

    return fields as RawRecord;
  }

  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }
}
