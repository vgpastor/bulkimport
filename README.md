# @bulkimport/core

Backend-agnostic bulk data import library for TypeScript/JavaScript. Schema validation, batch processing, pause/resume, and full event lifecycle — without coupling to any framework or database.

## Features

- **Schema validation** — Define field types, required fields, patterns, custom validators, and transforms
- **Batch processing** — Split large datasets into configurable batches
- **Pause / Resume / Abort** — Full control over long-running imports
- **Event-driven** — Subscribe to granular lifecycle events (import, batch, record level)
- **Preview mode** — Sample and validate records before committing to a full import
- **Pluggable architecture** — Bring your own parser, data source, or state store
- **Zero framework coupling** — Works with Express, Fastify, Hono, serverless, or standalone
- **Dual format** — Ships ESM and CJS with full TypeScript declarations

## Install

```bash
npm install @bulkimport/core
```

## Quick Start

```typescript
import { BulkImport, CsvParser, BufferSource } from '@bulkimport/core';

const importer = new BulkImport({
  schema: {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'age', type: 'number', required: false },
    ],
  },
  batchSize: 500,
  continueOnError: true,
});

importer.from(new BufferSource(csvString), new CsvParser());

// Preview first
const preview = await importer.preview(10);
console.log(preview.validRecords);
console.log(preview.invalidRecords);

// Process
await importer.start(async (record, context) => {
  await db.users.insert(record);
});
```

## Schema Definition

Each field supports:

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Column name to match |
| `type` | `'string' \| 'number' \| 'boolean' \| 'date' \| 'email' \| 'custom'` | Built-in type validation |
| `required` | `boolean` | Fail if missing or empty |
| `pattern` | `RegExp` | Regex validation |
| `customValidator` | `(value: unknown) => { valid: boolean; message?: string }` | Custom validation logic |
| `transform` | `(value: unknown) => unknown` | Transform value before validation |
| `defaultValue` | `unknown` | Applied when the field is undefined |

```typescript
const schema = {
  fields: [
    { name: 'email', type: 'email', required: true },
    {
      name: 'role',
      type: 'string',
      required: true,
      pattern: /^(admin|user|editor)$/,
    },
    {
      name: 'name',
      type: 'string',
      required: true,
      transform: (v) => String(v).trim().toUpperCase(),
    },
    {
      name: 'nif',
      type: 'custom',
      required: true,
      customValidator: (value) => ({
        valid: /^\d{8}[A-Z]$/.test(String(value)),
        message: 'Invalid NIF format',
      }),
    },
  ],
  strict: true, // Reject unknown fields
};
```

## Events

Subscribe to lifecycle events for progress tracking, logging, or UI updates:

```typescript
importer.on('import:started', (e) => {
  console.log(`Starting: ${e.totalRecords} records in ${e.totalBatches} batches`);
});

importer.on('batch:completed', (e) => {
  console.log(`Batch ${e.batchIndex}: ${e.processedCount}/${e.totalCount}`);
});

importer.on('record:failed', (e) => {
  console.log(`Record ${e.recordIndex} failed: ${e.error}`);
});

importer.on('import:progress', (e) => {
  console.log(`${e.progress.percentage}% complete`);
});

importer.on('import:completed', (e) => {
  console.log(`Done: ${e.summary.processed} processed, ${e.summary.failed} failed`);
});
```

**Available events:** `import:started`, `import:completed`, `import:paused`, `import:aborted`, `import:failed`, `import:progress`, `batch:started`, `batch:completed`, `batch:failed`, `record:processed`, `record:failed`

## Pause / Resume / Abort

```typescript
// Pause after a specific batch via events
importer.on('batch:completed', (e) => {
  if (e.batchIndex === 2) importer.pause();
});

await importer.start(processor);

// Later...
await importer.resume();

// Or cancel entirely
await importer.abort();

// Check status at any time
const { state, progress, batches } = await importer.getStatus();
```

## Real-World Example: Express + PostgreSQL

A complete example showing how to use `@bulkimport/core` in a REST API with a database:

```typescript
import express from 'express';
import { Pool } from 'pg';
import { BulkImport, CsvParser, BufferSource } from '@bulkimport/core';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.post('/api/import/users', async (req, res) => {
  const csvBuffer = req.body; // Raw CSV body

  const importer = new BulkImport({
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'string', required: true },
        {
          name: 'role',
          type: 'string',
          required: false,
          pattern: /^(admin|user|editor)$/,
          defaultValue: 'user',
        },
      ],
      strict: true,
    },
    batchSize: 500,
    continueOnError: true,
  });

  importer.from(new BufferSource(csvBuffer), new CsvParser());

  // Preview before committing
  const preview = await importer.preview(5);
  if (preview.invalidRecords.length > 0) {
    return res.status(422).json({
      message: 'Validation errors found in sample',
      errors: preview.invalidRecords.map((r) => ({
        row: r.index,
        fields: r.errors.map((e) => ({ field: e.field, message: e.message })),
      })),
    });
  }

  // Track progress via SSE, WebSocket, or just log
  importer.on('import:progress', (e) => {
    console.log(`Import ${e.jobId}: ${e.progress.percentage}%`);
  });

  // Process each valid record
  await importer.start(async (record, context) => {
    await pool.query(
      'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
      [record.email, record.name, record.role],
    );
  });

  const { progress } = await importer.getStatus();
  const failed = await importer.getFailedRecords();

  res.json({
    total: progress.totalRecords,
    processed: progress.processedRecords,
    failed: progress.failedRecords,
    errors: failed.map((r) => ({
      row: r.index,
      data: r.raw,
      reason: r.errors.map((e) => e.message).join('; '),
    })),
  });
});
```

## Works With

`@bulkimport/core` is framework and database agnostic. It works with anything that runs JavaScript:

### Frameworks

| Framework | Compatible | Notes |
|---|---|---|
| Express | Yes | Use with `multer` or raw body parser for file uploads |
| Fastify | Yes | Use `@fastify/multipart` for file handling |
| Hono | Yes | Works in Node, Deno, Bun, and Cloudflare Workers |
| NestJS | Yes | Wrap in a service, inject via DI |
| Next.js API Routes | Yes | Server-side only (API routes / Server Actions) |
| Nuxt Server Routes | Yes | `server/api/` handlers |
| tRPC | Yes | Call from procedures |
| AWS Lambda | Yes | Pair with S3 events or API Gateway |
| Serverless (Vercel/Netlify) | Yes | Mind the function timeout for large files |

### Databases / ORMs

| Database / ORM | Compatible | Notes |
|---|---|---|
| PostgreSQL (`pg`) | Yes | Use in the processor callback |
| MySQL (`mysql2`) | Yes | Use in the processor callback |
| MongoDB (`mongoose`) | Yes | `Model.insertMany` or per-record inserts |
| Prisma | Yes | `prisma.model.create()` in the processor |
| Drizzle ORM | Yes | Use `.insert()` in the processor |
| TypeORM | Yes | Use repository methods in the processor |
| SQLite (`better-sqlite3`) | Yes | Sync driver works inside async callback |
| Redis | Yes | Use for caching or as a queue |
| DynamoDB | Yes | `PutItem` per record or `BatchWriteItem` |
| Supabase | Yes | Use the JS client in the processor |

### Runtimes

| Runtime | Compatible | Notes |
|---|---|---|
| Node.js >= 16.7 | Yes | Full support |
| Bun | Yes | Full support |
| Deno | Yes | Via npm specifiers |
| Browsers | Partial | Parsing and validation work; file system sources do not |
| Cloudflare Workers | Partial | No `Buffer`, use string sources |

## Custom Adapters

The library is designed to be extended. Implement the port interfaces to plug in your own sources, parsers, or state stores.

### Data Source

Implement `DataSource` to read from any origin:

```typescript
import type { DataSource, SourceMetadata } from '@bulkimport/core';

class S3Source implements DataSource {
  async *read(): AsyncIterable<string | Buffer> {
    const stream = await s3.getObject({ Bucket: '...', Key: '...' });
    yield await stream.Body.transformToString();
  }

  async sample(maxBytes?: number): Promise<string | Buffer> {
    // Return a small chunk for preview
  }

  metadata(): SourceMetadata {
    return { fileName: 'data.csv', mimeType: 'text/csv' };
  }
}
```

### Parser

Implement `SourceParser` for any format:

```typescript
import type { SourceParser, RawRecord } from '@bulkimport/core';

class JsonParser implements SourceParser {
  async *parse(data: string | Buffer): AsyncIterable<RawRecord> {
    const items = JSON.parse(String(data));
    for (const item of items) {
      yield item;
    }
  }
}
```

### State Store

Implement `StateStore` to persist state to your database:

```typescript
import type { StateStore } from '@bulkimport/core';

class PostgresStateStore implements StateStore {
  async saveJobState(job) { /* INSERT/UPDATE */ }
  async getJobState(jobId) { /* SELECT */ }
  // ... implement all methods
}

const importer = new BulkImport({
  schema: { /* ... */ },
  stateStore: new PostgresStateStore(pool),
});
```

## API Reference

### `BulkImport`

| Method | Description |
|---|---|
| `from(source, parser)` | Set the data source and parser. Returns `this` for chaining. |
| `on(event, handler)` | Subscribe to a lifecycle event. Returns `this`. |
| `preview(maxRecords?)` | Validate a sample of records without processing. |
| `start(processor)` | Begin processing all records through the provided callback. |
| `pause()` | Pause processing after the current record. |
| `resume()` | Resume a paused import. |
| `abort()` | Cancel the import permanently. |
| `getStatus()` | Get current state, progress, and batch details. |
| `getFailedRecords()` | Get all records that failed validation or processing. |
| `getPendingRecords()` | Get records not yet processed. |
| `getJobId()` | Get the unique job identifier. |

### `BulkImportConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `schema` | `SchemaDefinition` | required | Field definitions and validation rules |
| `batchSize` | `number` | `100` | Records per batch |
| `continueOnError` | `boolean` | `false` | Keep processing when a record fails |
| `stateStore` | `StateStore` | `InMemoryStateStore` | Where to persist job state |

## Built-in Adapters

| Adapter | Description |
|---|---|
| `CsvParser` | CSV parsing with auto-delimiter detection (uses PapaParse) |
| `BufferSource` | Read from a string or Buffer in memory |
| `InMemoryStateStore` | Non-persistent state store (default) |

## Requirements

- Node.js >= 16.7.0 (uses `crypto.randomUUID` — stable since 16.7)
- TypeScript >= 5.0 (for consumers using TypeScript)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

## License

[MIT](./LICENSE)
