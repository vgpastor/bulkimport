# @batchactions/state-sequelize

Sequelize-based `StateStore` and `DistributedStateStore` adapter for [@batchactions/core](https://www.npmjs.com/package/@batchactions/core).

Persists import job state, processed records, and distributed batch metadata to any relational database supported by Sequelize v6 (PostgreSQL, MySQL, MariaDB, SQLite, MS SQL Server).

## Installation

```bash
npm install @batchactions/state-sequelize
```

**Peer dependencies:** `@batchactions/core` (>=0.1.0) and `sequelize` (^6.0.0) must be installed in your project.

## Usage

```typescript
import { BulkImport, CsvParser } from '@batchactions/import';
import { BufferSource } from '@batchactions/core';
import { SequelizeStateStore } from '@batchactions/state-sequelize';
import { Sequelize } from 'sequelize';

// Use your existing Sequelize instance
const sequelize = new Sequelize('postgres://user:pass@localhost:5432/mydb');

// Create and initialize the store (creates tables if they don't exist)
const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

// Pass it to BulkImport
const importer = new BulkImport({
  schema: { fields: [/* ... */] },
  batchSize: 500,
  continueOnError: true,
  stateStore,
});

importer.from(new BufferSource(csvString), new CsvParser());

await importer.start(async (record) => {
  await sequelize.models.User.create(record);
});
```

## Database Tables

The adapter creates three tables:

- **`bulkimport_jobs`** -- Import job state (status, config, batches as JSON, distributed flag)
- **`bulkimport_records`** -- Individual processed records (status, raw/parsed data, errors)
- **`bulkimport_batches`** -- Batch metadata for distributed processing (status, workerId, version for optimistic locking)

Tables are created automatically when you call `initialize()`. The call is idempotent.

## Distributed Processing

`SequelizeStateStore` fully implements the `DistributedStateStore` interface, enabling multi-worker parallel processing with [`@batchactions/distributed`](https://www.npmjs.com/package/@batchactions/distributed).

```bash
npm install @batchactions/distributed
```

```typescript
import { DistributedImport } from '@batchactions/distributed';
import { SequelizeStateStore } from '@batchactions/state-sequelize';

const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

const di = new DistributedImport({
  schema: { fields: [/* ... */] },
  batchSize: 500,
  stateStore,
});

// Orchestrator: prepare the job
const { jobId, totalBatches } = await di.prepare(source, parser);

// Worker: claim and process batches
const result = await di.processWorkerBatch(jobId, processor, workerId);
```

### Distributed Features

| Feature | Description |
|---|---|
| **Atomic batch claiming** | `claimBatch()` uses transactions + optimistic locking (`version` column) to ensure no two workers claim the same batch |
| **Stale batch recovery** | `reclaimStaleBatches(timeoutMs)` resets batches stuck in PROCESSING beyond the timeout |
| **Exactly-once finalization** | `tryFinalizeJob()` atomically transitions the job to COMPLETED/FAILED only once |
| **Batch record storage** | `saveBatchRecords()` / `getBatchRecords()` for bulk record persistence |
| **Distributed status** | `getDistributedStatus()` aggregates batch counts by status |

### Recommended Databases for Distributed Mode

| Database | Row Locking | Recommended |
|---|---|---|
| PostgreSQL | `FOR UPDATE SKIP LOCKED` | Yes |
| MySQL 8+ | `FOR UPDATE SKIP LOCKED` | Yes |
| MariaDB 10.6+ | `FOR UPDATE SKIP LOCKED` | Yes |
| SQLite | Single-writer (no concurrent transactions) | Dev/test only |

## Limitations

- Schema fields containing non-serializable values (`customValidator`, `transform`, `pattern`) are stripped when saving to the database. When restoring a job, the consumer must re-inject these fields.
- SQLite does not support concurrent transactions, so distributed batch claiming is limited to sequential use in tests. Use PostgreSQL or MySQL for production distributed processing.

## License

MIT
