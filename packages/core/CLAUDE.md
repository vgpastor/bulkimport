# CLAUDE.md — @batchactions/core

## Package Overview

Generic batch processing engine — state machine, events, ports, and infrastructure adapters. This is the foundational package of the `@batchactions` monorepo. Framework-agnostic, works in both Node.js and browsers.

## Architecture

Hexagonal Architecture (Ports & Adapters) with DDD tactical patterns.

```
packages/core/src/
├── domain/
│   ├── model/        # Job, Batch, Record, ValidationResult, JobStatus, BatchStatus
│   ├── ports/        # DataSource, StateStore, DistributedStateStore, RecordProcessor, JobHooks
│   ├── events/       # DomainEvents (discriminated unions)
│   └── services/     # BatchSplitter
├── application/
│   ├── EventBus.ts
│   ├── JobContext.ts        # Mutable state holder shared across use cases
│   └── usecases/            # StartJob, ProcessChunk, PauseJob, ResumeJob, AbortJob, GetJobStatus
├── infrastructure/
│   ├── sources/     # BufferSource, FilePathSource, StreamSource, UrlSource
│   └── state/       # InMemoryStateStore, FileStateStore
└── BatchEngine.ts   # Generic batch engine — composition root
```

### Layer rules

- `domain/` MUST NOT import from `application/`, `infrastructure/`, or external packages.
- `application/` may import from `domain/` only.
- `infrastructure/` implements `domain/ports/` interfaces and may use external packages.
- `BatchEngine.ts` is the composition root — wires everything together.
- `index.ts` is the public API surface — every export is intentional.

## Public API

- `BatchEngine` class + `BatchEngineConfig`, `ValidateFn` types
- Domain model types: `JobState`, `JobConfig`, `JobProgress`, `JobSummary`, `ProcessedRecord`, `RawRecord`, `ParsedRecord`, `RecordStatus`, `Batch`, `ValidationResult`, `ValidationError`, `ErrorSeverity`, `ErrorCategory`
- `JobStatus` and `BatchStatus` value enums (runtime exports)
- `JobStatusResult` type (return type of `getStatus()`)
- `ChunkOptions`, `ChunkResult` types (for `processChunk()`)
- `JobHooks`, `HookContext` types (lifecycle hooks port)
- Port interfaces: `DataSource`, `StateStore`, `RecordProcessorFn`, `ProcessingContext`
- Distributed types: `DistributedStateStore`, `BatchReservation`, `ClaimBatchResult`, `DistributedJobStatus`
- Domain events: `JobStartedEvent`, `JobCompletedEvent`, `JobPausedEvent`, `JobAbortedEvent`, `JobFailedEvent`, `JobProgressEvent`, `BatchStartedEvent`, `BatchCompletedEvent`, `BatchFailedEvent`, `RecordProcessedEvent`, `RecordFailedEvent`, `RecordRetriedEvent`, `ChunkCompletedEvent`, `BatchClaimedEvent`, `DistributedPreparedEvent`
- Domain services: `BatchSplitter`, `EventBus`, `JobContext`
- Helper functions: `hasErrors()`, `getWarnings()`, `getErrors()`, `validResult()`, `invalidResult()`, `isEmptyRow()`
- Record functions: `createPendingRecord()`, `markRecordValid()`, `markRecordInvalid()`, `markRecordFailed()`
- Built-in sources: `BufferSource`, `FilePathSource`, `StreamSource`, `UrlSource`
- Built-in state stores: `InMemoryStateStore`, `FileStateStore`

## Dependencies

- Zero external dependencies in domain layer.
- `globalThis.crypto.randomUUID()` requires Node.js >= 20.

## Testing

```bash
npm test -w packages/core
```

- **Acceptance tests** (`tests/acceptance/`): Full workflows through `BatchEngine`.
- **Unit tests** (`tests/unit/`): Domain logic in isolation (JobStatus state machine, EventBus, BatchSplitter).
- Config: `vitest.config.ts` with `resolve.alias` for workspace deps.

## Build

```bash
npm run build -w packages/core
```

Dual format: ESM + CJS + `.d.ts` via `tsup`. Must build first — other packages depend on it.
