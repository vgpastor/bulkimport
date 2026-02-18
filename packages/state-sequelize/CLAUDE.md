# CLAUDE.md — @batchactions/state-sequelize

## Package Overview

Sequelize v6 adapter for `StateStore` and `DistributedStateStore` ports from `@batchactions/core`. Persists import job state, processed records, and distributed batch metadata to any relational database supported by Sequelize (PostgreSQL, MySQL, MariaDB, SQLite, MS SQL Server).

## Architecture

```
packages/state-sequelize/src/
├── SequelizeStateStore.ts   # Main class implementing StateStore + DistributedStateStore
├── models/
│   ├── JobModel.ts          # Sequelize model for batchactions_jobs table
│   ├── RecordModel.ts       # Sequelize model for batchactions_records table
│   └── BatchModel.ts        # Sequelize model for batchactions_batches table
├── mappers/
│   ├── JobMapper.ts         # Domain ↔ DB row mapping for jobs
│   └── RecordMapper.ts      # Domain ↔ DB row mapping for records
├── utils/
│   └── parseJson.ts         # Safe JSON parsing utility
└── index.ts                 # Public API surface
```

## Database Tables

| Table | Description |
|-------|-------------|
| `batchactions_jobs` | Job state (status, config, batches as JSON, distributed flag) |
| `batchactions_records` | Individual processed records (status, raw/parsed data, errors) |
| `batchactions_batches` | Batch metadata for distributed processing (status, workerId, version for optimistic locking) |

Tables are created automatically via `initialize()` (idempotent).

## Dependencies

- **Peer dependencies**: `@batchactions/core` (>= 0.0.1), `sequelize` (^6.0.0)

## Public API

- `SequelizeStateStore` class + `SequelizeStateStoreOptions`

## Key Implementation Details

- **Atomic batch claiming**: Uses transactions + optimistic locking (`version` column) to ensure no two workers claim the same batch.
- **Stale batch recovery**: `reclaimStaleBatches(timeoutMs)` resets batches stuck in PROCESSING beyond the timeout.
- **Exactly-once finalization**: `tryFinalizeJob()` atomically transitions the job to COMPLETED/FAILED only once.
- **Dual state tracking**: Batch state is tracked both in the `batchactions_batches` table and as JSON in the `batchactions_jobs` row for backward compatibility with non-distributed mode.

## Testing

```bash
npm test -w packages/state-sequelize
```

- **Integration tests** (`tests/integration/`): Full round-trip tests with SQLite in-memory.
- Uses `sequelize` + `sqlite3` as dev dependencies for testing.
- Config: `vitest.config.ts` with alias `@batchactions/core` → `../core/src/index.ts`.

## Build

```bash
npm run build -w packages/state-sequelize
```

Requires `@batchactions/core` to be built first.

## Limitations

- Non-serializable schema fields (`customValidator`, `transform`, `pattern`) are stripped when saving to the database. The consumer must re-inject them when restoring a job.
- SQLite does not support concurrent transactions — distributed batch claiming is sequential in tests. Use PostgreSQL or MySQL for production distributed processing.
