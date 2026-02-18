# @batchactions

Backend-agnostic batch data processing monorepo for TypeScript/JavaScript. Schema validation, batch processing, pause/resume, distributed workers, and full event lifecycle — without coupling to any framework or database.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@batchactions/core`](./packages/core/) | Generic batch processing engine — state machine, events, ports, infrastructure adapters | [![npm](https://img.shields.io/npm/v/@batchactions/core)](https://www.npmjs.com/package/@batchactions/core) |
| [`@batchactions/import`](./packages/import/) | Import-specific layer — schema validation, CSV/JSON/XML parsers, template generation | [![npm](https://img.shields.io/npm/v/@batchactions/import)](https://www.npmjs.com/package/@batchactions/import) |
| [`@batchactions/distributed`](./packages/distributed/) | Distributed multi-worker batch processing for serverless | [![npm](https://img.shields.io/npm/v/@batchactions/distributed)](https://www.npmjs.com/package/@batchactions/distributed) |
| [`@batchactions/state-sequelize`](./packages/state-sequelize/) | Sequelize v6 adapter for `StateStore` + `DistributedStateStore` | [![npm](https://img.shields.io/npm/v/@batchactions/state-sequelize)](https://www.npmjs.com/package/@batchactions/state-sequelize) |

## Features

- **Schema validation** — Define field types, required fields, patterns, custom validators, transforms, column aliases, and unique field detection
- **Batch processing** — Split large datasets into configurable batches with optional concurrency
- **Pause / Resume / Abort** — Full control over long-running jobs
- **Event-driven** — Subscribe to granular lifecycle events (job, batch, record level)
- **Preview mode** — Sample and validate records before committing to a full import
- **Serverless-ready** — `processChunk()` for environments with execution time limits (Vercel, Lambda)
- **Distributed processing** — Fan out N parallel workers with atomic batch claiming
- **Lifecycle hooks** — Intercept the pipeline with `beforeValidate`, `afterValidate`, `beforeProcess`, `afterProcess`
- **External duplicate detection** — Plug in a `DuplicateChecker` to check against your database
- **Extended errors** — Severity levels (error/warning), categories, suggestions, and metadata on validation errors
- **Pluggable architecture** — Bring your own parser, data source, or state store
- **Zero framework coupling** — Works with Express, Fastify, Hono, serverless, or standalone
- **Dual format** — Ships ESM and CJS with full TypeScript declarations

## Quick Start

```bash
npm install @batchactions/core @batchactions/import
```

```typescript
import { BulkImport, CsvParser, BufferSource } from '@batchactions/import';

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

## Events

Subscribe to lifecycle events for progress tracking, logging, or UI updates:

```typescript
importer.on('job:started', (e) => {
  console.log(`Starting: ${e.totalRecords} records in ${e.totalBatches} batches`);
});

importer.on('batch:completed', (e) => {
  console.log(`Batch ${e.batchIndex}: ${e.processedCount}/${e.totalCount}`);
});

importer.on('record:failed', (e) => {
  console.log(`Record ${e.recordIndex} failed: ${e.error}`);
});

importer.on('job:progress', (e) => {
  console.log(`${e.progress.percentage}% complete`);
});

importer.on('job:completed', (e) => {
  console.log(`Done: ${e.summary.processed} processed, ${e.summary.failed} failed`);
});
```

**Available events:** `job:started`, `job:completed`, `job:paused`, `job:aborted`, `job:failed`, `job:progress`, `batch:started`, `batch:completed`, `batch:failed`, `batch:claimed`, `record:processed`, `record:failed`, `record:retried`, `chunk:completed`, `distributed:prepared`

### Wildcard Subscription

Subscribe to all events at once with `onAny()` — ideal for SSE or WebSocket relay:

```typescript
importer.onAny((event) => {
  sseStream.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
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

## Serverless Mode (`processChunk`)

Process records in time-limited chunks for serverless environments:

```typescript
import { BulkImport, CsvParser } from '@batchactions/import';
import { UrlSource } from '@batchactions/core';
import { SequelizeStateStore } from '@batchactions/state-sequelize';

const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

// Process up to 25 seconds (Vercel cuts at 30s)
const result = await importer.processChunk(processor, { maxDurationMs: 25000 });

return Response.json({
  jobId: result.jobId,
  done: result.done,
  processed: result.totalProcessed,
  failed: result.totalFailed,
});
```

## Distributed Processing (Multi-Worker)

For large-scale imports, fan out processing across N parallel workers:

```bash
npm install @batchactions/distributed @batchactions/state-sequelize sequelize pg
```

```typescript
import { DistributedImport } from '@batchactions/distributed';
import { SequelizeStateStore } from '@batchactions/state-sequelize';
import { CsvParser } from '@batchactions/import';
import { UrlSource } from '@batchactions/core';

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

// === Worker Lambda ===
while (true) {
  const result = await di.processWorkerBatch(jobId, async (record) => {
    await db.users.upsert(record);
  }, workerId);
  if (!result.claimed || result.jobComplete) break;
}
```

## Built-in Adapters

| Adapter | Package | Type | Description |
|---|---|---|---|
| `CsvParser` | `@batchactions/import` | Parser | CSV parsing with auto-delimiter detection (PapaParse) |
| `JsonParser` | `@batchactions/import` | Parser | JSON array and NDJSON with auto-detection |
| `XmlParser` | `@batchactions/import` | Parser | XML parsing with auto record-tag detection |
| `BufferSource` | `@batchactions/core` | Source | Read from a string or Buffer in memory |
| `FilePathSource` | `@batchactions/core` | Source | Stream from a file path (Node.js only) |
| `StreamSource` | `@batchactions/core` | Source | Accept `AsyncIterable` or `ReadableStream` |
| `UrlSource` | `@batchactions/core` | Source | Fetch and stream from a URL |
| `InMemoryStateStore` | `@batchactions/core` | State | Non-persistent state store (default) |
| `FileStateStore` | `@batchactions/core` | State | JSON files on disk — persistent across restarts |
| `SequelizeStateStore` | `@batchactions/state-sequelize` | State | SQL database persistence via Sequelize v6 |

## Requirements

- Node.js >= 20.0.0 (uses `crypto.randomUUID` — global `crypto` stable since Node 20)
- TypeScript >= 5.0 (for consumers using TypeScript)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

## License

[MIT](./LICENSE)
