# @batchactions

Backend-agnostic batch data processing for TypeScript/JavaScript.

This monorepo contains the packages needed to parse, validate, process, and persist large imports with support for pause/resume, serverless chunking, and distributed workers.

## Packages

| Package | Purpose | npm |
|---|---|---|
| [`@batchactions/core`](./packages/core/README.md) | Core batch engine, state model, events, sources, and state stores | [npm](https://www.npmjs.com/package/@batchactions/core) |
| [`@batchactions/import`](./packages/import/README.md) | High-level import facade with schema validation + CSV/JSON/XML parsers | [npm](https://www.npmjs.com/package/@batchactions/import) |
| [`@batchactions/distributed`](./packages/distributed/README.md) | Multi-worker orchestration for distributed processing | [npm](https://www.npmjs.com/package/@batchactions/distributed) |
| [`@batchactions/state-sequelize`](./packages/state-sequelize/README.md) | Sequelize adapter for `StateStore` and `DistributedStateStore` | [npm](https://www.npmjs.com/package/@batchactions/state-sequelize) |

## Install

```bash
npm install @batchactions/core @batchactions/import
```

Add these when needed:

```bash
npm install @batchactions/distributed @batchactions/state-sequelize sequelize
```

## Quick Start

```typescript
import { BulkImport, CsvParser, BufferSource } from '@batchactions/import';

const importer = new BulkImport({
  schema: {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'string', required: true },
    ],
  },
  batchSize: 500,
  continueOnError: true,
});

importer.from(new BufferSource('email,name\nuser@example.com,Ada'), new CsvParser());

const preview = await importer.preview(10);
console.log(preview.validRecords.length, preview.invalidRecords.length);

await importer.start(async (record) => {
  await db.users.insert(record);
});
```

## Core Features

- Schema validation and transforms
- Batch processing with configurable size and concurrency
- Pause, resume, abort, and restore flows
- Rich lifecycle events (`job:*`, `batch:*`, `record:*`)
- Serverless-friendly chunk processing (`processChunk`)
- Distributed worker mode with atomic batch claiming
- Pluggable architecture (sources, parsers, state stores)

## Documentation Map

- Root contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- `@batchactions/core`: [`packages/core/README.md`](./packages/core/README.md)
- `@batchactions/import`: [`packages/import/README.md`](./packages/import/README.md)
- `@batchactions/distributed`: [`packages/distributed/README.md`](./packages/distributed/README.md)
- `@batchactions/state-sequelize`: [`packages/state-sequelize/README.md`](./packages/state-sequelize/README.md)

## Requirements

- Node.js >= 20.0.0
- TypeScript >= 5.0 (if using TypeScript)

## License

MIT
