# CLAUDE.md — @batchactions/distributed

## Package Overview

Distributed multi-worker batch processing for `@batchactions/core`. Implements a two-phase model: an orchestrator calls `prepare()` to materialize records and create batch metadata, then N workers call `processWorkerBatch()` to claim and process batches concurrently.

## Architecture

```
packages/distributed/src/
├── DistributedImport.ts     # Facade — orchestrates prepare + worker batch processing
├── usecases/
│   ├── PrepareDistributedImport.ts   # Phase 1: stream source, materialize records, create batches
│   └── ProcessDistributedBatch.ts    # Phase 2: claim batch, load records, process, finalize
└── index.ts                 # Public API surface
```

## Dependencies

- **Peer dependencies**: `@batchactions/core` (>= 0.0.1), `@batchactions/import` (>= 0.0.1)

## Public API

- `DistributedImport` class + `DistributedImportConfig`
- `PrepareResult`, `DistributedBatchResult`, `DistributedBatchConfig` types
- Re-exports core distributed types

## Key Concepts

- **Prepare phase**: Orchestrator streams the data source, validates records via schema, materializes them in the `DistributedStateStore`, and creates batch metadata with record index ranges.
- **Worker phase**: Each worker calls `claimBatch()` (atomic via optimistic locking), loads its assigned records, processes them, and calls `tryFinalizeJob()` on the last batch.
- **Recovery**: `reclaimStaleBatches(timeoutMs)` resets batches stuck in PROCESSING beyond the timeout threshold.

## Testing

```bash
npm test -w packages/distributed
```

- **Acceptance tests** (`tests/acceptance/`): Full prepare → claim → process → finalize cycles.
- Config: `vitest.config.ts` with aliases for `@batchactions/core` and `@batchactions/import`.

## Build

```bash
npm run build -w packages/distributed
```

Requires `@batchactions/core` and `@batchactions/import` to be built first.
