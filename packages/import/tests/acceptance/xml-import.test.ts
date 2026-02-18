import { describe, it, expect } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { XmlParser } from '../../src/infrastructure/parsers/XmlParser.js';
import { BufferSource } from '@batchactions/core';
import type { RawRecord } from '@batchactions/core';

describe('XML Import', () => {
  it('should process XML records through the full pipeline', async () => {
    const xml = `
      <users>
        <user>
          <email>alice@test.com</email>
          <name>Alice</name>
          <age>30</age>
        </user>
        <user>
          <email>bob@test.com</email>
          <name>Bob</name>
          <age>25</age>
        </user>
        <user>
          <email>charlie@test.com</email>
          <name>Charlie</name>
          <age>35</age>
        </user>
      </users>
    `;

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 2,
      continueOnError: true,
    });

    importer.from(new BufferSource(xml), new XmlParser({ recordTag: 'user' }));

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(3);
    expect(processed[0]).toEqual(expect.objectContaining({ email: 'alice@test.com', name: 'Alice', age: '30' }));

    const status = importer.getStatus();
    expect(status.status).toBe('COMPLETED');
    expect(status.progress.processedRecords).toBe(3);
    expect(status.batches).toHaveLength(2); // 2 + 1
  });

  it('should validate XML records and report failures', async () => {
    const xml = `
      <users>
        <user>
          <email>valid@test.com</email>
          <name>Valid</name>
        </user>
        <user>
          <email>not-an-email</email>
          <name>Invalid</name>
        </user>
      </users>
    `;

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });

    importer.from(new BufferSource(xml), new XmlParser({ recordTag: 'user' }));

    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(await importer.getFailedRecords()).toHaveLength(1);
    expect(importer.getStatus().status).toBe('COMPLETED');
  });

  it('should preview XML records', async () => {
    const xml = `
      <items>
        <item><email>a@test.com</email><name>A</name></item>
        <item><email>b@test.com</email><name>B</name></item>
        <item><email>c@test.com</email><name>C</name></item>
      </items>
    `;

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(xml), new XmlParser({ recordTag: 'item' }));
    const preview = await importer.preview(2);

    expect(preview.totalSampled).toBe(2);
    expect(preview.validRecords).toHaveLength(2);
    expect(preview.columns).toContain('email');
    expect(preview.columns).toContain('name');
  });

  it('should handle XML with special characters', async () => {
    const xml = `
      <data>
        <row>
          <email>test@test.com</email>
          <name>Smith &amp; Jones</name>
        </row>
      </data>
    `;

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      },
    });

    importer.from(new BufferSource(xml), new XmlParser({ recordTag: 'row' }));
    const processed: RawRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]?.name).toBe('Smith & Jones');
  });
});
