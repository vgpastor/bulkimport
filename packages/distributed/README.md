# @bulkimport/distributed

Distributed parallel batch processing for [@bulkimport/core](https://www.npmjs.com/package/@bulkimport/core). Fan out N workers (AWS Lambda, Cloud Functions, ECS tasks, etc.) to process batches concurrently with atomic claiming, crash recovery, and exactly-once completion.

## When to Use This

Use `@bulkimport/distributed` when:

- You need to import **hundreds of thousands or millions of records** and a single process is too slow.
- You are running in **serverless** (AWS Lambda, Google Cloud Functions) and want to parallelize across multiple invocations.
- You need **crash resilience** — if a worker dies, another worker picks up the batch.

For simpler scenarios (< 100k records, single server), `@bulkimport/core` alone is sufficient. Use `processChunk()` for serverless with time limits, or `maxConcurrentBatches` for in-process parallelism.

## Installation

```bash
npm install @bulkimport/distributed
```

**Peer dependencies:**

- `@bulkimport/core` >= 0.4.0

You also need a `DistributedStateStore` implementation. The official one is [`@bulkimport/state-sequelize`](https://www.npmjs.com/package/@bulkimport/state-sequelize):

```bash
npm install @bulkimport/state-sequelize sequelize pg
```

## How It Works

A two-phase processing model:

```
                  Phase 1: PREPARE (single orchestrator)
                  ┌─────────────────────────────────┐
                  │ Stream source file               │
                  │ Validate & materialize records    │
                  │ Create batch boundaries           │
                  │ Save everything to StateStore     │
                  └──────────┬──────────────────────-─┘
                             │
                    { jobId, totalBatches }
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    Phase 2: PROCESS (N parallel workers)
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  Worker 1    │ │  Worker 2    │ │  Worker N    │
    │  claimBatch  │ │  claimBatch  │ │  claimBatch  │
    │  process     │ │  process     │ │  process     │
    │  next batch  │ │  next batch  │ │  next batch  │
    │  ...         │ │  ...         │ │  ...         │
    └──────────────┘ └──────────────┘ └──────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    tryFinalizeJob()
                    (exactly-once)
```

1. **Prepare** (orchestrator): Streams the source file, validates field names, materializes all records in the `StateStore`, and registers batch boundaries. Returns `{ jobId, totalBatches }`.

2. **Process** (workers): Each worker calls `processWorkerBatch()` in a loop. The method atomically claims the next available batch (no two workers get the same batch), loads its records, runs the full validation + hooks + duplicate-check + processor pipeline, and marks the batch as completed or failed. When the last batch finishes, `tryFinalizeJob()` transitions the job to COMPLETED (exactly once).

## Quick Start

### Orchestrator (Phase 1)

```typescript
import { DistributedImport } from '@bulkimport/distributed';
import { CsvParser, UrlSource } from '@bulkimport/core';
import { SequelizeStateStore } from '@bulkimport/state-sequelize';
import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(process.env.DATABASE_URL!);
const stateStore = new SequelizeStateStore(sequelize);
await stateStore.initialize();

const di = new DistributedImport({
  schema: {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'role', type: 'string', required: false, defaultValue: 'user' },
    ],
  },
  batchSize: 500,
  stateStore,
  continueOnError: true,
});

// Phase 1: Prepare
const source = new UrlSource('https://storage.example.com/users.csv');
const { jobId, totalBatches, totalRecords } = await di.prepare(source, new CsvParser());

console.log(`Job ${jobId}: ${totalRecords} records in ${totalBatches} batches`);

// Fan out: send { jobId } to N workers via SQS, SNS, EventBridge, etc.
await sqs.sendMessage({
  QueueUrl: WORKER_QUEUE_URL,
  MessageBody: JSON.stringify({ jobId }),
});
```

### Worker (Phase 2)

```typescript
import { DistributedImport } from '@bulkimport/distributed';
import { SequelizeStateStore } from '@bulkimport/state-sequelize';
import { Sequelize } from 'sequelize';

// Lambda handler
export async function handler(event: SQSEvent, context: Context) {
  const { jobId } = JSON.parse(event.Records[0].body);
  const workerId = context.awsRequestId;

  const sequelize = new Sequelize(process.env.DATABASE_URL!);
  const stateStore = new SequelizeStateStore(sequelize);
  await stateStore.initialize();

  const di = new DistributedImport({
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'role', type: 'string', required: false, defaultValue: 'user' },
      ],
    },
    batchSize: 500,
    stateStore,
    continueOnError: true,
  });

  // Process batches until none remain
  while (true) {
    const result = await di.processWorkerBatch(jobId, async (record) => {
      await db.query(
        'INSERT INTO users (email, name, role) VALUES ($1, $2, $3)',
        [record.email, record.name, record.role],
      );
    }, workerId);

    if (!result.claimed) {
      console.log('No more batches to process');
      break;
    }

    console.log(`Batch ${result.batchIndex}: ${result.processedCount} processed, ${result.failedCount} failed`);

    if (result.jobComplete) {
      console.log('Job finalized by this worker!');
      break;
    }
  }
}
```

## Configuration

### `DistributedImportConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `schema` | `SchemaDefinition` | required | Field definitions and validation rules |
| `batchSize` | `number` | `100` | Records per batch |
| `continueOnError` | `boolean` | `true` | Continue when records fail validation or processing |
| `stateStore` | `StateStore` | required | Must implement `DistributedStateStore` (e.g. `SequelizeStateStore`) |
| `maxRetries` | `number` | `0` | Retry attempts for processor failures (exponential backoff) |
| `retryDelayMs` | `number` | `1000` | Base delay in ms between retry attempts |
| `hooks` | `ImportHooks` | -- | Lifecycle hooks (`beforeValidate`, `afterValidate`, `beforeProcess`, `afterProcess`) |
| `duplicateChecker` | `DuplicateChecker` | -- | External duplicate detection |
| `staleBatchTimeoutMs` | `number` | `900000` | Timeout in ms before stale batches are reclaimed (15 min default) |

## API Reference

### `DistributedImport`

| Method | Description |
|---|---|
| `prepare(source, parser)` | Phase 1: Stream source, materialize records, create batches. Returns `PrepareResult`. |
| `processWorkerBatch(jobId, processor, workerId)` | Phase 2: Claim next batch, process records, finalize if last. Returns `DistributedBatchResult`. |
| `on(event, handler)` | Subscribe to a domain event. |
| `onAny(handler)` | Subscribe to all events. |
| `offAny(handler)` | Unsubscribe a wildcard handler. |

### `PrepareResult`

| Field | Type | Description |
|---|---|---|
| `jobId` | `string` | Unique job identifier. Pass this to workers. |
| `totalRecords` | `number` | Total records found in the source. |
| `totalBatches` | `number` | Number of batches created. |

### `DistributedBatchResult`

| Field | Type | Description |
|---|---|---|
| `claimed` | `boolean` | Whether a batch was successfully claimed. `false` means no batches remain. |
| `batchId` | `string?` | ID of the batch that was processed. |
| `batchIndex` | `number?` | Index of the batch that was processed. |
| `processedCount` | `number` | Records successfully processed in this batch. |
| `failedCount` | `number` | Records that failed in this batch. |
| `jobComplete` | `boolean` | `true` if this worker finalized the entire job. |
| `jobId` | `string` | The job identifier. |

## Crash Recovery

If a worker crashes or times out, its claimed batch becomes "stale". The next `processWorkerBatch()` call automatically reclaims stale batches (based on `staleBatchTimeoutMs`) before claiming new ones.

**Requirements:**

- Your **processor callback must be idempotent**. If a batch is re-processed after a crash, records may be sent to the processor again.
- Use `ON CONFLICT DO NOTHING` / `INSERT ... IGNORE` or similar patterns in your database writes.

You can also manually reclaim stale batches:

```typescript
import { isDistributedStateStore } from '@bulkimport/distributed';

if (isDistributedStateStore(stateStore)) {
  const reclaimed = await stateStore.reclaimStaleBatches(jobId, 60_000); // 1 min timeout
  console.log(`Reclaimed ${reclaimed} stale batches`);
}
```

## Events

Each worker has its own local event bus. Subscribe to events for logging, metrics, or progress tracking:

```typescript
di.on('batch:claimed', (e) => {
  console.log(`Worker claimed batch ${e.batchIndex} of job ${e.jobId}`);
});

di.on('record:failed', (e) => {
  console.error(`Record ${e.recordIndex} failed: ${e.error}`);
});

di.on('import:completed', (e) => {
  // Only emitted by the worker that finalizes the job
  console.log(`Job complete! ${e.summary.processed} processed, ${e.summary.failed} failed`);
});

// Forward all events (e.g. to CloudWatch, Datadog)
di.onAny((event) => {
  metrics.emit(event.type, event);
});
```

**Note:** `import:completed` is emitted only by the worker that finalizes the job (exactly once).

## Architecture

```
@bulkimport/distributed
├── DistributedImport.ts          # Facade (composition root)
├── PrepareDistributedImport.ts   # Phase 1 use case
├── ProcessDistributedBatch.ts    # Phase 2 use case
└── index.ts                      # Public API

Depends on:
└── @bulkimport/core
    ├── DistributedStateStore     # Port interface (extended StateStore)
    ├── BatchReservation          # Domain types
    ├── SchemaValidator           # Validation pipeline
    └── EventBus                  # Event system

Implemented by:
└── @bulkimport/state-sequelize
    └── SequelizeStateStore       # Concrete DistributedStateStore
        ├── bulkimport_jobs       # Job state table
        ├── bulkimport_records    # Record data table
        └── bulkimport_batches    # Batch metadata table (distributed)
```

## Implementing a Custom `DistributedStateStore`

If you don't use Sequelize, you can implement the `DistributedStateStore` interface:

```typescript
import type { DistributedStateStore, ClaimBatchResult, DistributedJobStatus, ProcessedRecord } from '@bulkimport/distributed';

class MyDistributedStore implements DistributedStateStore {
  // ... all StateStore methods plus:

  async claimBatch(jobId: string, workerId: string): Promise<ClaimBatchResult> {
    // Atomic: find first PENDING batch, set to PROCESSING with workerId
    // Use SELECT FOR UPDATE SKIP LOCKED or similar
  }

  async releaseBatch(jobId: string, batchId: string, workerId: string): Promise<void> {
    // Reset batch to PENDING (only if claimed by this worker)
  }

  async reclaimStaleBatches(jobId: string, timeoutMs: number): Promise<number> {
    // Find PROCESSING batches with claimedAt older than timeout, reset to PENDING
  }

  async saveBatchRecords(jobId: string, batchId: string, records: readonly ProcessedRecord[]): Promise<void> {
    // Bulk insert records for a batch
  }

  async getBatchRecords(jobId: string, batchId: string): Promise<readonly ProcessedRecord[]> {
    // Load all records for a batch
  }

  async getDistributedStatus(jobId: string): Promise<DistributedJobStatus> {
    // Aggregate: count batches by status
  }

  async tryFinalizeJob(jobId: string): Promise<boolean> {
    // Atomic: if all batches are terminal, set job to COMPLETED/FAILED
    // Return true if THIS call finalized (exactly-once)
  }
}
```

## Requirements

- Node.js >= 20.0.0
- `@bulkimport/core` >= 0.4.0
- A `DistributedStateStore` implementation (e.g. `@bulkimport/state-sequelize` >= 0.1.2)

## License

[MIT](../../LICENSE)
