# @batchactions/state-sequelize

Sequelize adapter that implements both `StateStore` and `DistributedStateStore` for `@batchactions`.

Use this package to persist job state, records, and distributed batch metadata in SQL databases supported by Sequelize v6.

## Install

```bash
npm install @batchactions/state-sequelize @batchactions/core sequelize
```

For distributed mode:

```bash
npm install @batchactions/distributed @batchactions/import
```

## Quick Start

```typescript
import { Sequelize } from 'sequelize';
import { SequelizeStateStore } from '@batchactions/state-sequelize';
import { BulkImport, CsvParser, BufferSource } from '@batchactions/import';

const sequelize = new Sequelize(process.env.DATABASE_URL!);
const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

const importer = new BulkImport({
  schema: { fields: [{ name: 'email', type: 'email', required: true }] },
  stateStore,
});

importer.from(new BufferSource('email\nuser@example.com'), new CsvParser());
await importer.start(async (record) => {
  await saveUser(record);
});
```

## Tables Created

- `batchactions_jobs`
- `batchactions_records`
- `batchactions_batches`

`initialize()` is idempotent and can be called safely on startup.

## Distributed Support

`SequelizeStateStore` supports:

- Atomic batch claiming (`claimBatch`)
- Stale batch reclaiming (`reclaimStaleBatches`)
- Batch-level record persistence
- Exactly-once job finalization (`tryFinalizeJob`)

## Limitations

- Non-serializable schema fields (`customValidator`, `transform`, `pattern`) are stripped before persistence and must be re-injected when restoring jobs.
- SQLite is suitable for development/tests, but not recommended for high-concurrency distributed processing.

## Compatibility

- Node.js >= 20.0.0
- Peer dependencies:
- `@batchactions/core` >= 0.0.1
- `sequelize` ^6.0.0

## Links

- Repository: https://github.com/vgpastor/batchactions/tree/main/packages/state-sequelize
- Issues: https://github.com/vgpastor/batchactions/issues
- Contributing guide: https://github.com/vgpastor/batchactions/blob/main/CONTRIBUTING.md

## License

MIT
