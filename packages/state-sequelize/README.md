# @bulkimport/state-sequelize

Sequelize-based `StateStore` adapter for [@bulkimport/core](https://www.npmjs.com/package/@bulkimport/core).

Persists import job state and processed records to any relational database supported by Sequelize v6 (PostgreSQL, MySQL, MariaDB, SQLite, MS SQL Server).

## Installation

```bash
npm install @bulkimport/state-sequelize
```

**Peer dependencies:** `@bulkimport/core` (>=0.1.0) and `sequelize` (^6.0.0) must be installed in your project.

## Usage

```typescript
import { BulkImport } from '@bulkimport/core';
import { SequelizeStateStore } from '@bulkimport/state-sequelize';
import { Sequelize } from 'sequelize';

// Use your existing Sequelize instance
const sequelize = new Sequelize('postgres://user:pass@localhost:5432/mydb');

// Create and initialize the store (creates tables if they don't exist)
const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

// Pass it to BulkImport
const importer = new BulkImport({
  schema: { fields: [/* ... */] },
  source: mySource,
  parser: myParser,
  processor: myProcessor,
  stateStore,
});

await importer.start();
```

## Database Tables

The adapter creates two tables:

- **`bulkimport_jobs`** - Import job state (status, config, batches as JSON)
- **`bulkimport_records`** - Individual processed records (status, raw/parsed data, errors)

Tables are created automatically when you call `initialize()`. The call is idempotent.

## Limitations

Schema fields containing non-serializable values (`customValidator`, `transform`, `pattern`) are stripped when saving to the database. When restoring a job, the consumer must re-inject these fields.

## License

MIT
