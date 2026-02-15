# @bulkimport/core

Backend-agnostic bulk data import library for TypeScript/JavaScript. Schema validation, batch processing, pause/resume, and full event lifecycle — without coupling to any framework or database.

## Features

- **Schema validation** — Define field types, required fields, patterns, custom validators, transforms, column aliases, and unique field detection
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
| `type` | `'string' \| 'number' \| 'boolean' \| 'date' \| 'email' \| 'array' \| 'custom'` | Built-in type validation |
| `required` | `boolean` | Fail if missing or empty |
| `pattern` | `RegExp` | Regex validation |
| `customValidator` | `(value: unknown) => { valid: boolean; message?: string }` | Custom validation logic |
| `transform` | `(value: unknown) => unknown` | Transform value after parsing |
| `defaultValue` | `unknown` | Applied when the field is undefined |
| `separator` | `string` | For `array` type: split character (default: `','`) |
| `aliases` | `string[]` | Alternative column names that map to this field |

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

### Array Fields

Declare `type: 'array'` to auto-split delimited strings into arrays:

```typescript
const schema = {
  fields: [
    { name: 'email', type: 'email', required: true },
    { name: 'tags', type: 'array', required: false },            // splits on ','
    { name: 'zones', type: 'array', required: true, separator: ';' }, // splits on ';'
  ],
};

// CSV: email,tags,zones
//      alice@test.com,"admin,editor","zone-a;zone-b"
// → { email: 'alice@test.com', tags: ['admin', 'editor'], zones: ['zone-a', 'zone-b'] }
```

### Column Aliases

Map alternative column headers to canonical field names:

```typescript
const schema = {
  fields: [
    { name: 'email', type: 'email', required: true, aliases: ['correo', 'mail', 'e-mail'] },
    { name: 'name', type: 'string', required: true, aliases: ['nombre', 'full_name'] },
  ],
};

// CSV with Spanish headers: "Correo,Nombre" → resolved to { email, name }
// Case-insensitive: "EMAIL,NAME" → resolved to { email, name }
```

### Unique Field Detection

Detect duplicate values across the entire import:

```typescript
const schema = {
  fields: [
    { name: 'identifier', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
  ],
  uniqueFields: ['identifier'], // Duplicates produce DUPLICATE_VALUE errors
};
```

Uniqueness is tracked across all batches (not per-batch). String comparisons are case-insensitive. Empty values are skipped.

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

#### Ready-made: Sequelize adapter

If you use Sequelize v6, install the official adapter instead of writing your own:

```bash
npm install @bulkimport/state-sequelize
```

```typescript
import { BulkImport, CsvParser, BufferSource } from '@bulkimport/core';
import { SequelizeStateStore } from '@bulkimport/state-sequelize';
import { Sequelize } from 'sequelize';

// Use your existing Sequelize instance
const sequelize = new Sequelize('postgres://user:pass@localhost:5432/mydb');

// Create and initialize (creates tables if they don't exist)
const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

const importer = new BulkImport({
  schema: {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'string', required: true },
    ],
  },
  batchSize: 500,
  continueOnError: true,
  stateStore, // Persists job state and records to your database
});

importer.from(new BufferSource(csvString), new CsvParser());

await importer.start(async (record) => {
  await sequelize.models.User.create(record);
});

// After processing, query persisted state directly
const failedRecords = await stateStore.getFailedRecords(importer.getJobId());
const progress = await stateStore.getProgress(importer.getJobId());
```

The adapter creates two tables (`bulkimport_jobs` and `bulkimport_records`) and works with any Sequelize-supported dialect: PostgreSQL, MySQL, MariaDB, SQLite, or MS SQL Server. See the [state-sequelize README](./packages/state-sequelize/README.md) for details.

## API Reference

### `BulkImport`

| Method | Description |
|---|---|
| `static generateTemplate(schema)` | Generate a CSV header line from schema field names. |
| `static restore(jobId, config)` | Restore an interrupted import from persisted state. Returns `null` if not found. |
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
| `schema` | `SchemaDefinition` | required | Field definitions, validation rules, `skipEmptyRows`, `strict`, `uniqueFields` |
| `batchSize` | `number` | `100` | Records per batch |
| `maxConcurrentBatches` | `number` | `1` | Number of batches to process in parallel |
| `continueOnError` | `boolean` | `false` | Keep processing when a record fails |
| `stateStore` | `StateStore` | `InMemoryStateStore` | Where to persist job state |

## Concurrent Batch Processing

Process multiple batches in parallel for higher throughput:

```typescript
const importer = new BulkImport({
  schema: { fields: [...] },
  batchSize: 500,
  maxConcurrentBatches: 4, // Process 4 batches at a time
  continueOnError: true,
});
```

With `maxConcurrentBatches: 1` (default), batches are processed sequentially. Set a higher value when the processor callback involves I/O (database inserts, API calls) and the downstream system can handle parallel writes.

## Restore Interrupted Imports

Resume imports that were interrupted by crashes, deploys, or timeouts:

```typescript
import { BulkImport, CsvParser, FilePathSource, FileStateStore } from '@bulkimport/core';

const stateStore = new FileStateStore({ directory: '.bulkimport' });

// First run — may be interrupted
const importer = new BulkImport({
  schema: { fields: [...] },
  stateStore,
});
importer.from(new FilePathSource('data.csv'), new CsvParser());
await importer.start(processor);
const jobId = importer.getJobId();

// After restart — restore and continue
const restored = await BulkImport.restore(jobId, {
  schema: { fields: [...] }, // Same schema
  stateStore,
});

if (restored) {
  restored.from(new FilePathSource('data.csv'), new CsvParser());
  await restored.start(processor); // Skips already-completed batches
}
```

## Built-in Adapters

| Adapter | Type | Description |
|---|---|---|
| `CsvParser` | Parser | CSV parsing with auto-delimiter detection (uses PapaParse) |
| `JsonParser` | Parser | JSON array and NDJSON with auto-detection. Nested objects flattened to strings |
| `XmlParser` | Parser | XML parsing with auto record-tag detection. Zero dependencies |
| `BufferSource` | Source | Read from a string or Buffer in memory |
| `FilePathSource` | Source | Stream from a file path with configurable chunk size (Node.js only) |
| `StreamSource` | Source | Accept `AsyncIterable` or `ReadableStream` (ideal for upload streams) |
| `UrlSource` | Source | Fetch and stream from a URL (requires `fetch` — Node.js >= 18) |
| `InMemoryStateStore` | State | Non-persistent state store (default) |
| `FileStateStore` | State | JSON files on disk — persistent across restarts (Node.js only) |

### Companion Packages

| Package | Description |
|---|---|
| [`@bulkimport/state-sequelize`](./packages/state-sequelize/) | Sequelize v6 adapter for `StateStore`. Persists to PostgreSQL, MySQL, SQLite, etc. |

## Requirements

- Node.js >= 16.7.0 (uses `crypto.randomUUID` — stable since 16.7)
- TypeScript >= 5.0 (for consumers using TypeScript)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

## License

[MIT](./LICENSE)
