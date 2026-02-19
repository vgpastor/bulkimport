# @batchactions/distributed

Distributed orchestration for `@batchactions` imports.

Use this package when one process is not enough and you need multiple workers (Lambda, containers, queue workers) claiming and processing batches in parallel.

## Install

```bash
npm install @batchactions/distributed @batchactions/core @batchactions/import
```

You also need a `DistributedStateStore` implementation. Choose one:

```bash
# Option A: Sequelize
npm install @batchactions/state-sequelize sequelize

# Option B: Prisma (v6 or v7)
npm install @batchactions/state-prisma
```

## Processing Model

1. `prepare(source, parser)` runs once in an orchestrator process.
2. `processWorkerBatch(jobId, processor, workerId)` runs in N workers until no batches remain.

## Quick Start

```typescript
import { DistributedImport } from '@batchactions/distributed';
import { CsvParser } from '@batchactions/import';
import { UrlSource } from '@batchactions/core';
import { SequelizeStateStore } from '@batchactions/state-sequelize';

const di = new DistributedImport({
  schema: {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'string', required: true },
    ],
  },
  batchSize: 500,
  stateStore: new SequelizeStateStore(sequelize),
  continueOnError: true,
});

const source = new UrlSource('https://storage.example.com/users.csv');
const { jobId } = await di.prepare(source, new CsvParser());

while (true) {
  const result = await di.processWorkerBatch(jobId, processRecord, workerId);
  if (!result.claimed || result.jobComplete) break;
}
```

## Main Exports

- `DistributedImport`
- `PrepareResult`
- `DistributedBatchResult`, `DistributedBatchConfig`
- `DistributedStateStore` related types (re-exported)
- `isDistributedStateStore`

For full typed exports, see `packages/distributed/src/index.ts`.

## Compatibility

- Node.js >= 20.0.0
- Peer dependencies:
- `@batchactions/core` >= 0.0.1
- `@batchactions/import` >= 0.0.1

## Operational Notes

- Worker processors must be idempotent.
- Stale claimed batches are reclaimed automatically based on `staleBatchTimeoutMs`.
- Job finalization is exactly-once via `tryFinalizeJob()` in the store.

## Links

- Repository: https://github.com/vgpastor/batchactions/tree/main/packages/distributed
- Issues: https://github.com/vgpastor/batchactions/issues
- Contributing guide: https://github.com/vgpastor/batchactions/blob/main/CONTRIBUTING.md

## License

MIT
