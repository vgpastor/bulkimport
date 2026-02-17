# @bulkimport/core

Backend-agnostic bulk data import library for TypeScript/JavaScript. Schema validation, batch processing, pause/resume, and full event lifecycle — without coupling to any framework or database.

## Features

- **Schema validation** — Define field types, required fields, patterns, custom validators, transforms, column aliases, and unique field detection
- **Batch processing** — Split large datasets into configurable batches
- **Pause / Resume / Abort** — Full control over long-running imports
- **Event-driven** — Subscribe to granular lifecycle events (import, batch, record level)
- **Preview mode** — Sample and validate records before committing to a full import
- **Serverless-ready** — `processChunk()` for environments with execution time limits (Vercel, Lambda)
- **Lifecycle hooks** — Intercept the pipeline with `beforeValidate`, `afterValidate`, `beforeProcess`, `afterProcess`
- **External duplicate detection** — Plug in a `DuplicateChecker` to check against your database
- **Extended errors** — Severity levels (error/warning), categories, suggestions, and metadata on validation errors
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
| `customValidator` | `(value: unknown) => ValidationFieldResult` | Custom validation logic (can return `severity`, `suggestion`, `metadata`) |
| `transform` | `(value: unknown) => unknown` | Transform value after parsing |
| `defaultValue` | `unknown` | Applied when the field is undefined |
| `separator` | `string` | For `array` type: split character (default: `','`) |
| `itemTransform` | `(item: string) => string` | For `array` type: transform applied to each element after splitting |
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

Use `itemTransform` to normalize each element after splitting:

```typescript
const schema = {
  fields: [
    { name: 'email', type: 'email', required: true },
    {
      name: 'zones',
      type: 'array',
      required: true,
      separator: ';',
      itemTransform: (s) => s.toLowerCase(),
    },
  ],
};

// CSV: email,zones
//      alice@test.com," Zone-A ; Zone-B "
// → { email: 'alice@test.com', zones: ['zone-a', 'zone-b'] }
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

**Available events:** `import:started`, `import:completed`, `import:paused`, `import:aborted`, `import:failed`, `import:progress`, `batch:started`, `batch:completed`, `batch:failed`, `batch:claimed`, `record:processed`, `record:failed`, `record:retried`, `chunk:completed`, `distributed:prepared`

### Wildcard Subscription

Subscribe to all events at once with `onAny()` — ideal for SSE or WebSocket relay:

```typescript
importer.onAny((event) => {
  sseStream.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
});
```

## Serverless Mode (`processChunk`)

Process records in time-limited chunks for serverless environments like Vercel or AWS Lambda:

```typescript
import { BulkImport, CsvParser, UrlSource } from '@bulkimport/core';
import { SequelizeStateStore } from '@bulkimport/state-sequelize';

// Use an external StateStore — serverless has no persistent filesystem or memory
const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

const schema = { fields: [...] };

export async function POST(req: Request) {
  const { jobId, fileUrl } = await req.json();

  let importer: BulkImport;

  if (jobId) {
    // Subsequent invocation — restore from persisted state
    const restored = await BulkImport.restore(jobId, { schema, stateStore });
    if (!restored) return Response.json({ error: 'Job not found' }, { status: 404 });
    importer = restored;
  } else {
    // First invocation — create a new import
    importer = new BulkImport({ schema, batchSize: 100, stateStore, continueOnError: true });
  }

  // Source must be available on every invocation (URL, S3, etc.)
  importer.from(new UrlSource(fileUrl), new CsvParser());

  // Process up to 25 seconds (Vercel cuts at 30s)
  const result = await importer.processChunk(processor, { maxDurationMs: 25000 });

  return Response.json({
    jobId: result.jobId,
    done: result.done,
    processed: result.totalProcessed,
    failed: result.totalFailed,
  });
}
```

You can limit by record count (`maxRecords`) or duration (`maxDurationMs`), or both.

> **Important:** In serverless environments (Vercel, Lambda, Cloudflare Workers) both the filesystem and memory are ephemeral — they do not persist between invocations. You must use an external `StateStore` such as [`@bulkimport/state-sequelize`](./packages/state-sequelize/) or implement your own adapter (Redis, DynamoDB, etc.). The source data must also be accessible on every invocation via a URL, S3, or similar — not a local file path. `FileStateStore` and `InMemoryStateStore` are designed for long-running servers or local development only.

## Distributed Processing (Multi-Worker)

For large-scale imports (hundreds of thousands of records), fan out processing across N parallel workers using [`@bulkimport/distributed`](./packages/distributed/):

```bash
npm install @bulkimport/distributed @bulkimport/state-sequelize sequelize pg
```

The distributed model has two phases:

1. **Prepare** (single orchestrator): streams the source file and materializes all records in the database.
2. **Process** (N parallel workers): each worker atomically claims a batch, processes it, and the last one finalizes the job.

```typescript
import { DistributedImport } from '@bulkimport/distributed';
import { SequelizeStateStore } from '@bulkimport/state-sequelize';
import { CsvParser, UrlSource } from '@bulkimport/core';

const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

const di = new DistributedImport({
  schema: { fields: [/* ... */] },
  batchSize: 500,
  stateStore,
  continueOnError: true,
});

// === Orchestrator Lambda ===
const source = new UrlSource('https://storage.example.com/data.csv');
const { jobId, totalBatches } = await di.prepare(source, new CsvParser());
// Send { jobId } to N workers via SQS/SNS

// === Worker Lambda ===
const workerId = context.awsRequestId;
while (true) {
  const result = await di.processWorkerBatch(jobId, async (record) => {
    await db.users.upsert(record);
  }, workerId);

  if (!result.claimed || result.jobComplete) break;
}
```

Workers self-coordinate through atomic batch claiming -- no central dispatcher needed. If a worker crashes, its batch is automatically reclaimed after a configurable timeout (`staleBatchTimeoutMs`, default 15 min).

> **Note:** The processor callback **must be idempotent** since batches may be re-processed after a crash. Use `ON CONFLICT DO NOTHING` or similar patterns. See the [`@bulkimport/distributed` README](./packages/distributed/README.md) for the full API and architecture details.

## Lifecycle Hooks

Intercept the record processing pipeline for data enrichment, error modification, or side effects:

```typescript
const importer = new BulkImport({
  schema: { fields: [...] },
  hooks: {
    // Modify raw data before validation (e.g. data enrichment)
    beforeValidate: async (record, ctx) => {
      return { ...record, source: 'import' };
    },
    // Inspect/modify record after validation (e.g. downgrade errors to warnings)
    afterValidate: async (record, ctx) => record,
    // Modify parsed data before the processor callback
    beforeProcess: async (parsed, ctx) => parsed,
    // Side effects after successful processing (e.g. audit logging)
    afterProcess: async (record, ctx) => {
      await auditLog.write({ action: 'imported', recordIndex: ctx.recordIndex });
    },
  },
});
```

All hooks are optional and async. If a hook throws, the record is marked as failed (respects `continueOnError`).

## External Duplicate Detection

Check records against your database or API before processing:

```typescript
import type { DuplicateChecker } from '@bulkimport/core';

const checker: DuplicateChecker = {
  async check(fields, context) {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [fields.email]);
    return {
      isDuplicate: existing.length > 0,
      existingId: existing[0]?.id,
    };
  },
};

const importer = new BulkImport({
  schema: { fields: [...] },
  duplicateChecker: checker,
  continueOnError: true,
});
```

The checker is only called for records that pass internal validation. Duplicate records receive an `EXTERNAL_DUPLICATE` error code.

## Extended Error Model

Validation errors now support severity levels, categories, suggestions, and metadata:

```typescript
const schema = {
  fields: [
    {
      name: 'score',
      type: 'number',
      required: true,
      customValidator: (v) => {
        const num = Number(v);
        if (num < 60) {
          return {
            valid: false,
            message: 'Score is below threshold',
            severity: 'warning',      // Non-blocking — record still processed
            suggestion: 'Review scores below 60 manually',
            metadata: { threshold: 60, actual: num },
          };
        }
        return { valid: true };
      },
    },
  ],
};
```

Use the helper functions to filter errors by severity:

```typescript
import { hasErrors, getWarnings, getErrors } from '@bulkimport/core';

const errors = record.errors;
if (hasErrors(errors)) { /* has blocking errors */ }
const warnings = getWarnings(errors);  // severity: 'warning' only
const hard = getErrors(errors);         // severity: 'error' or undefined
```

All built-in errors include a `category`: `'VALIDATION'` (REQUIRED, UNKNOWN_FIELD), `'FORMAT'` (TYPE_MISMATCH, PATTERN_MISMATCH), `'DUPLICATE'` (DUPLICATE_VALUE), `'CUSTOM'` (CUSTOM_VALIDATION).

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
| Serverless (Vercel/Netlify) | Yes | Use `processChunk()` + external `StateStore` (see [Serverless Mode](#serverless-mode-processchunk)) |

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
| `static generateTemplate(schema, options?)` | Generate a CSV template with header and optional synthetic example rows. |
| `static restore(jobId, config)` | Restore an interrupted import from persisted state. Returns `null` if not found. |
| `from(source, parser)` | Set the data source and parser. Returns `this` for chaining. |
| `on(event, handler)` | Subscribe to a lifecycle event. Returns `this`. |
| `onAny(handler)` | Subscribe to all events regardless of type. Returns `this`. |
| `offAny(handler)` | Unsubscribe a wildcard handler. Returns `this`. |
| `preview(maxRecords?)` | Validate a sample of records without processing. |
| `count()` | Count total records in the source without modifying state. |
| `start(processor)` | Begin processing all records through the provided callback. |
| `processChunk(processor, options?)` | Process a limited chunk of records, then pause. Returns `ChunkResult`. |
| `pause()` | Pause processing after the current record. |
| `resume()` | Resume a paused import. |
| `abort()` | Cancel the import permanently. |
| `getStatus()` | Get current status, progress, and batch details. Returns `{ status, state (deprecated), progress, batches }`. |
| `getFailedRecords()` | Get all records that failed validation or processing. Returns `Promise`. |
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
| `maxRetries` | `number` | `0` | Retry attempts for processor failures (exponential backoff) |
| `retryDelayMs` | `number` | `1000` | Base delay between retry attempts |
| `hooks` | `ImportHooks` | — | Lifecycle hooks (`beforeValidate`, `afterValidate`, `beforeProcess`, `afterProcess`) |
| `duplicateChecker` | `DuplicateChecker` | — | External duplicate detection adapter |

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
| [`@bulkimport/state-sequelize`](./packages/state-sequelize/) | Sequelize v6 adapter for `StateStore` + `DistributedStateStore`. Persists to PostgreSQL, MySQL, SQLite, etc. |
| [`@bulkimport/distributed`](./packages/distributed/) | Distributed multi-worker batch processing. Fan out N Lambda/Cloud Functions to process in parallel. |

## Requirements

- Node.js >= 16.7.0 (uses `crypto.randomUUID` — stable since 16.7)
- TypeScript >= 5.0 (for consumers using TypeScript)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

## License

[MIT](./LICENSE)
