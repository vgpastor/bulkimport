# CLAUDE.md — @batchactions monorepo

## Project Overview

Public npm monorepo for backend-agnostic batch data processing with schema validation, batch processing, and state management. Designed to be consumed by any TypeScript/JavaScript project regardless of framework or runtime. The core engine works in both Node.js and browsers.

### Packages

| Package | Description | Path |
|---------|-------------|------|
| `@batchactions/core` | Generic batch processing engine — state machine, events, ports, infrastructure adapters | `packages/core/` |
| `@batchactions/import` | Import-specific layer — schema validation, parsers (CSV/JSON/XML), template generation, `BulkImport` facade | `packages/import/` |
| `@batchactions/distributed` | Distributed multi-worker batch processing — prepare/claim/process model | `packages/distributed/` |
| `@batchactions/state-sequelize` | Sequelize v6 adapter for `StateStore` + `DistributedStateStore` ports | `packages/state-sequelize/` |

## Architecture

Hexagonal Architecture (Ports & Adapters) with DDD tactical patterns, split across a monorepo.

### `@batchactions/core` — Generic batch engine

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

### `@batchactions/import` — Import-specific layer

```
packages/import/src/
├── domain/
│   ├── model/        # Schema, FieldDefinition, PreviewResult
│   ├── ports/        # SourceParser, DuplicateChecker
│   └── services/     # SchemaValidator
├── application/
│   └── usecases/     # PreviewImport
├── infrastructure/
│   └── parsers/      # CsvParser, JsonParser, XmlParser
└── BulkImport.ts     # Import facade — wraps BatchEngine with schema + parsers
```

### Layer rules

- `domain/` MUST NOT import from `application/`, `infrastructure/`, or external packages.
- `application/` may import from `domain/` only.
- `infrastructure/` implements `domain/ports/` interfaces and may use external packages.
- `BatchEngine.ts` / `BulkImport.ts` are composition roots — wire everything together.
- `index.ts` per package is the public API surface — every export is intentional.
- `@batchactions/import` depends on `@batchactions/core` (peer dependency).
- `@batchactions/distributed` depends on `@batchactions/core` and `@batchactions/import` (peer dependencies).
- `@batchactions/state-sequelize` depends on `@batchactions/core` and `sequelize` (peer dependencies).

### Key domain concepts

- **JobStatus**: Finite state machine with explicit valid transitions (`canTransition()`). Terminal states: COMPLETED, ABORTED, FAILED.
- **Batch**: Immutable grouping of records. Processed sequentially or concurrently.
- **ProcessedRecord**: Immutable record that progresses through statuses: pending → valid/invalid → processed/failed.
- **SchemaDefinition** (import): Declares fields with types, required flag, pattern, custom validator, transform, and default value.
- **Domain Events**: Typed with discriminated unions. `EventPayload<T>` extracts the correct event type.
- **ValidationResult**: Includes `isValid`, `errors`, and optional `parsed` field for carrying transformed data back to the engine.

## Design Principles

Strictly follow these principles in order of priority:

1. **Outside-In development (London School)** — Start from acceptance tests that describe behavior from the consumer's perspective, then drill into unit tests for domain logic. Use doubles for ports (interfaces), never for implementations.
2. **DDD** — Domain model is the core. Business rules live in `domain/`. No framework or infrastructure leaks into the domain. Respect bounded contexts and ubiquitous language: Job, Batch, Record, Schema, ValidationResult.
3. **SOLID** — Single responsibility per file/class. Depend on abstractions (ports), not concretions. Open for extension via new adapters.
4. **Clean Code** — Small functions, meaningful names, no comments that restate the code. No magic numbers or strings. Early returns over deep nesting.
5. **Immutability** — All types use `readonly`. Records transform through pure functions, never mutation.

## Mandatory Post-Change Checklist

After every implementation task, **before considering the task complete**, verify:

1. **Run the full pipeline**: `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`
2. **Update `todo.md`**: Mark completed items as `[x]`, add new items discovered during implementation.
3. **Update `CLAUDE.md`**: If the change affects architecture, public API, known gaps, or technical decisions — update the relevant sections.
4. **Update `README.md`**: If the change modifies or adds to the public API (new methods, new config options, new adapters), update usage examples and API reference.

This checklist is non-negotiable. Documentation drift is a bug.

## Coding Conventions

### TypeScript

- Strict mode: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- Shared compiler options in `tsconfig.base.json` at monorepo root. Each package extends it.
- Use `type` imports (`import type { ... }`) for types that are erased at runtime.
- Prefer `interface` for object shapes, `type` for unions and intersections.
- Use `as const` objects + derived type for enums (see `JobStatus.ts`, `BatchStatus.ts`).
- No `any`. Use `unknown` when the type is genuinely unknown.
- No classes in domain model — use plain interfaces + factory functions (e.g., `createBatch()`, `createPendingRecord()`). Classes are acceptable for services (`SchemaValidator`) and infrastructure adapters.
- Barrel exports in `index.ts` only. No intermediate barrel files.

### Naming

- Files: PascalCase for types/classes (`JobStatus.ts`), camelCase for pure function modules if needed.
- Types/Interfaces: PascalCase, no `I` prefix.
- Functions: camelCase, verb-first (`createBatch`, `markRecordValid`, `canTransition`).
- Events: namespace:action format (`job:started`, `batch:completed`, `record:failed`).
- Constants: PascalCase object with `as const` (not SCREAMING_SNAKE).

### File structure

- One concept per file. `Record.ts` contains the record type and all its transition functions.
- Ports are one interface per file.
- Domain events are all in a single file (`DomainEvents.ts`) since they form a discriminated union.

## Testing

### Strategy

- **Acceptance tests** (`tests/acceptance/`): Test full workflows through the public facades. Primary tests — validate behavior from the consumer's perspective. Write these FIRST.
- **Unit tests** (`tests/unit/`): Test domain logic in isolation (SchemaValidator, JobStatus state machine, EventBus).
- Use doubles (mocks/stubs) for ports (interfaces), never for implementations.
- No mocks for domain logic. Mocks only for infrastructure boundaries when needed.
- Coverage targets: 90% domain, 80% global.

### Running tests

```bash
# All packages (from monorepo root)
npm test                        # vitest run across all workspaces
npm run typecheck               # tsc --noEmit across all workspaces
npm run lint                    # eslint across all workspaces

# Single package
npm test -w @batchactions/core
npm test -w @batchactions/import
npm test -w @batchactions/distributed
npm test -w @batchactions/state-sequelize
```

### Test configuration

- `vitest.workspace.ts` at monorepo root references all package configs.
- Each package has its own `vitest.config.ts` with `resolve.alias` mappings for workspace dependencies (e.g., `@batchactions/core` → `../core/src/index.ts`). This allows tests to run against source TypeScript without requiring a prior build.

### Test conventions

- Use `describe` blocks named after the unit or scenario.
- Test names describe expected behavior: `"should skip invalid records and track failures when continueOnError is true"`.
- Helpers at the top of test files (e.g., `generateCsv()`, `createImporter()`).
- No test should depend on another test's state.

## Build & Publish

```bash
npm run build    # tsup across all workspaces → dist/ (ESM + CJS + .d.ts)
```

- Dual format: ESM (`.mjs`) + CJS (`.cjs`) with TypeScript declarations (`.d.ts`).
- Only `dist/` is published (`"files": ["dist"]`).
- Path aliases (`@domain/*`, `@application/*`, `@infrastructure/*`) are for dev/test only in `@batchactions/core` — not used in source code (all imports are relative).
- Target: ES2020 for maximum compatibility (Node 20+, modern browsers).
- `globalThis.crypto.randomUUID()` requires Node.js >= 20.
- Build order: `core` → `import` → `distributed` / `state-sequelize` (core must build first for tsc resolution via package `exports`).

## Public API Surface

### `@batchactions/core`

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

### `@batchactions/import`

- `BulkImport` class + `BulkImportConfig`, `GenerateTemplateOptions` types
- Schema types: `SchemaDefinition`, `FieldDefinition`, `FieldType`, `ValidationFieldResult`, `PreviewResult`
- `SchemaValidator` domain service
- Ports: `SourceParser`, `ParserOptions`, `DuplicateChecker`, `DuplicateCheckResult`
- Built-in parsers: `CsvParser`, `JsonParser`, `XmlParser`
- Re-exports commonly used types from `@batchactions/core` for convenience

### `@batchactions/distributed`

- `DistributedImport` class + `DistributedImportConfig`
- `PrepareResult`, `DistributedBatchResult`, `DistributedBatchConfig` types
- Re-exports core distributed types

### `@batchactions/state-sequelize`

- `SequelizeStateStore` class + `SequelizeStateStoreOptions`

## Breaking Changes Policy

**NEVER remove or change public API directly.** Always deprecate first (`@deprecated` + runtime `console.warn`), then remove in the next major version.

## Technical Decisions

- **Streaming obligatory**: Never load the entire file in memory. Use `AsyncIterable` / `ReadableStream` to process record by record. Handles files with millions of records.
- **AbortController for pause/resume**: Native `AbortController` for cancellation signals. Pause is implemented by resolving a Promise that stays pending until `resume()`.
- **Typed Event Emitter**: No `any`. Each event has its own payload type via discriminated unions.
- **Zero dependencies in domain**: Domain layers have NO external dependencies. Adapters (infrastructure) may use PapaParse, fast-xml-parser, etc.
- **ID generation**: `crypto.randomUUID()` (native Node 20+ and modern browsers).
- **Error boundaries**: Each batch runs inside try/catch. A failing batch does not stop others when `continueOnError: true`. Consumer processor errors are captured in the record, never propagated to the engine.
- **Retry with exponential backoff**: `maxRetries` and `retryDelayMs` config options. Only processor failures are retried. Backoff formula: `retryDelayMs * 2^(attempt - 1)`. Each retry emits a `record:retried` event.
- **Transformed data flow**: `ValidationResult.parsed` carries transformed data from the validation pipeline back to the engine, so `SchemaValidator` transforms are applied before the processor receives records.
- **DuplicateChecker via hooks**: Since `ValidateFn` in core is synchronous, the async `DuplicateChecker` port is integrated through the `afterValidate` lifecycle hook in `BulkImport.buildHooks()`.
- **Vitest aliases for dev**: Each package's `vitest.config.ts` maps workspace dependencies to source TypeScript, bypassing the need to build before testing.

## Scope Boundaries

- Does NOT expose HTTP endpoints. It is a library, not a server.
- Does NOT have a UI. Logic and data only.
- Does NOT choose a database. The consumer decides via the processor callback.
- Does NOT parse binary formats (Excel, etc.). Text only: CSV, JSON, XML.
- Does NOT do automatic column mapping. The schema defines expectations.
- Does NOT retain data in memory. Records pass through the callback and are discarded once processed (except what the StateStore persists).

## Current State & Known Gaps

Monorepo refactored from `@bulkimport/core` to `@batchactions` with 4 packages. All packages at version `0.0.2`.

### Implemented

**@batchactions/core:**
- Streaming batch processing — `start()` parses lazily and processes batch-by-batch.
- `maxConcurrentBatches` — real batch concurrency via `Promise.race` pool. Default: 1 (sequential).
- O(1) progress tracking, batch lookup, and record upsert in state stores.
- Memory release — `clearBatchRecords()` frees record data after each batch completes.
- Memory-safe failed records — `getFailedRecords()` delegates to StateStore.
- Full StateStore integration — persists records and batch transitions for crash recovery.
- `BatchEngine.restore(jobId, config)` — static method to resume interrupted jobs.
- Pause/resume/abort with AbortController.
- Domain events with typed EventBus — handler errors are isolated.
- `onAny()` / `offAny()` wildcard event subscription.
- Deferred `job:started` event — emitted in the next microtask.
- Lifecycle hooks (`JobHooks`) — 4 optional async hooks: `beforeValidate`, `afterValidate`, `beforeProcess`, `afterProcess`.
- Retry mechanism — `maxRetries`, `retryDelayMs`, exponential backoff, `record:retried` event.
- `processChunk()` — serverless-friendly chunked processing with `maxRecords` and `maxDurationMs` limits.
- Extended error model — `ValidationError` with `severity`, `category`, `suggestion`, `metadata`. Warning-severity errors are non-blocking.
- Distributed processing types — `DistributedStateStore` port, `BatchReservation`, `ClaimBatchResult`, domain events.
- Built-in sources: `BufferSource`, `FilePathSource`, `StreamSource`, `UrlSource`.
- Built-in state stores: `InMemoryStateStore`, `FileStateStore`.

**@batchactions/import:**
- Full validation pipeline (string, number, boolean, date, email, array, custom validators).
- Array field type with configurable separator and `itemTransform`.
- Column aliases — case-insensitive header mapping via `resolveAliases()`.
- Unique field duplicate detection — cross-batch tracking, case-insensitive for strings.
- `DuplicateChecker` port — external duplicate detection via `afterValidate` hook.
- `BulkImport.generateTemplate(schema, options?)` — generate CSV template with example rows.
- `BulkImport.count()` — stream-count total records without modifying state.
- Preview with sampling.
- `skipEmptyRows` — shared `isEmptyRow()` function.
- Built-in parsers: `CsvParser`, `JsonParser`, `XmlParser`.
- JSDoc on all public API types and methods.

**@batchactions/distributed:**
- Two-phase model: `prepare()` (orchestrator) + `processWorkerBatch()` (N workers claim batches atomically).
- Recovery via `reclaimStaleBatches()`. Exactly-once completion via `tryFinalizeJob()`.

**@batchactions/state-sequelize:**
- Sequelize v6 adapter for `StateStore` + `DistributedStateStore` ports.
- Persists job state, records, and distributed batch metadata to SQL databases.
- Atomic batch claiming, optimistic locking, stale batch recovery, exactly-once job finalization.
- Tables: `batchactions_jobs`, `batchactions_records`, `batchactions_batches`.

**Monorepo:**
- npm workspaces with `packages/*` pattern.
- Shared `tsconfig.base.json` extended by all packages.
- ESLint 9 flat config + Prettier configured per package.
- `vitest.workspace.ts` at root for unified test runs.
- 448+ tests passing across all packages.

### Known Gaps

No major gaps remaining. See `todo.md` for the full backlog.
