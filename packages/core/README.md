# @batchactions/core

Core batch processing engine for the `@batchactions` ecosystem.

Use this package when you need low-level control of batch orchestration, state transitions, events, and infrastructure adapters.

## Install

```bash
npm install @batchactions/core
```

## What You Get

- `BatchEngine` for streaming batch execution
- Job lifecycle control: start, pause, resume, abort, process chunk
- Domain events for job, batch, and record progress
- Built-in sources: `BufferSource`, `FilePathSource`, `StreamSource`, `UrlSource`
- Built-in state stores: `InMemoryStateStore`, `FileStateStore`
- Distributed contracts: `DistributedStateStore`, `BatchReservation`, helpers

## Quick Start

```typescript
import { BatchEngine, BufferSource, InMemoryStateStore } from '@batchactions/core';

const engine = new BatchEngine({
  stateStore: new InMemoryStateStore(),
  batchSize: 100,
  maxConcurrentBatches: 2,
  continueOnError: true,
});

engine.from(new BufferSource(JSON.stringify([{ id: 1 }, { id: 2 }])), {
  async *parse(chunk) {
    const rows = JSON.parse(chunk.toString()) as Array<Record<string, unknown>>;
    for (const row of rows) {
      yield row;
    }
  },
});

await engine.start(async (record) => {
  await processRecord(record);
});
```

## Main Exports

- `BatchEngine`
- `BatchSplitter`
- `EventBus`, `JobContext`
- `JobStatus`, `BatchStatus`
- `BufferSource`, `FilePathSource`, `StreamSource`, `UrlSource`
- `InMemoryStateStore`, `FileStateStore`
- `isDistributedStateStore`

For full typed exports, see `packages/core/src/index.ts`.

## Compatibility

- Node.js >= 20.0.0

## Related Packages

- `@batchactions/import`: high-level import facade
- `@batchactions/distributed`: multi-worker orchestration
- `@batchactions/state-sequelize`: SQL persistence adapter

## Links

- Repository: https://github.com/vgpastor/batchactions/tree/main/packages/core
- Issues: https://github.com/vgpastor/batchactions/issues
- Contributing guide: https://github.com/vgpastor/batchactions/blob/main/CONTRIBUTING.md

## License

MIT
