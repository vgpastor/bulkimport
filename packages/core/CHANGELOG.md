# Changelog — @batchactions/core

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.4] - 2026-02-19

### Changed

- **Documentation** — Added `@batchactions/state-prisma` to Related Packages in README.

## [0.0.2] - 2026-02-18

### Changed

- **Package rename & version downgrade** — Package renamed from `@bulkimport/core` to `@batchactions/core`. Version numbers reset to `0.0.x` to reflect the new package scope. This is a **downgrade in version number only** — all functionality from the previous releases under `@bulkimport/core` is preserved.

---

## Historical Changelog (under previous `@bulkimport/core` package name)

> The entries below document the development history under the original `@bulkimport/core` name.
> All functionality is carried forward into `@batchactions/core`.

---

## [0.5.0] - 2026-02-17

### Added

- **Distributed processing domain types** — `DistributedStateStore` port interface (extends `StateStore`), `BatchReservation`, `ClaimBatchResult`, `ClaimBatchFailureReason`, `DistributedJobStatus` model types. `isDistributedStateStore()` type guard for runtime detection. All additive, zero breaking changes.
- **Distributed domain events** — `batch:claimed` (emitted when a worker claims a batch) and `distributed:prepared` (emitted after prepare phase materializes all records). Added to the `DomainEvent` discriminated union.
- **Optional distributed fields on domain models** — `Batch` gains optional `workerId?`, `claimedAt?`, `recordStartIndex?`, `recordEndIndex?`. `ImportJobState` gains optional `distributed?` flag. Non-breaking.
- **`processChunk()` — Serverless mode** — `await importer.processChunk(processor, { maxRecords: 100, maxDurationMs: 25000 })` processes a limited chunk of records and returns control. Designed for serverless environments with execution time limits (Vercel, Lambda). Chunk boundaries are at the batch level. Call `restore()` + `processChunk()` in subsequent invocations to continue. Returns `ChunkResult` with `done` flag, per-chunk and cumulative counters.
- **`ChunkCompletedEvent`** domain event — emitted after each chunk finishes with `processedRecords`, `failedRecords`, and `done` flag.
- **`ChunkOptions`** and **`ChunkResult`** types exported from the public API.
- **Lifecycle hooks** — `ImportHooks` interface with 4 optional async hooks: `beforeValidate`, `afterValidate`, `beforeProcess`, `afterProcess`. Hooks intercept the record processing pipeline for data enrichment, error modification, and side effects. Hook errors mark the record as failed (respects `continueOnError`).
- **`ImportHooks`** and **`HookContext`** types exported from the public API.
- **`DuplicateChecker` port** — interface for checking records against external data sources (database, API) for duplicates. Only invoked for records that pass internal validation. Returns `DuplicateCheckResult` with `isDuplicate`, `existingId?`, and `metadata?`. Checker errors are handled gracefully (record marked as failed).
- **`DuplicateChecker`** and **`DuplicateCheckResult`** types exported from the public API.
- **`EXTERNAL_DUPLICATE`** validation error code for records flagged by the `DuplicateChecker`.
- **Extended error model** — `ValidationError` now supports optional `severity` (`'error'` | `'warning'`), `category` (`'VALIDATION'` | `'FORMAT'` | `'DUPLICATE'` | `'PROCESSING'` | `'CUSTOM'`), `suggestion` (actionable hint), and `metadata` (structured data). All new fields are optional — fully backward-compatible.
- **Warning-level errors are non-blocking** — records with only `severity: 'warning'` errors pass through to the processor. Warnings are preserved in the record's `errors` array.
- **`hasErrors()`**, **`getWarnings()`**, **`getErrors()`** helper functions exported from the public API for filtering `ValidationError` arrays by severity.
- **`ErrorSeverity`** and **`ErrorCategory`** types exported from the public API.
- **`ValidationFieldResult`** extended — custom validators can now return `severity`, `suggestion`, and `metadata` in addition to `valid` and `message`.
- **`category` populated on all built-in errors** — `REQUIRED` → `'VALIDATION'`, `TYPE_MISMATCH` → `'FORMAT'`, `PATTERN_MISMATCH` → `'FORMAT'`, `UNKNOWN_FIELD` → `'VALIDATION'`, `DUPLICATE_VALUE` → `'DUPLICATE'`, `CUSTOM_VALIDATION` → `'CUSTOM'`.

## [0.4.1] - 2026-02-16

### Added

- **Deferred `import:started` event** — the event is now emitted after yielding to the microtask queue (`await Promise.resolve()`), so handlers registered after `start()` on the same tick receive it.
- **`generateTemplate()` with example rows** — `BulkImport.generateTemplate(schema, { exampleRows: 2 })` generates a CSV with synthetic data rows.
- **`onAny()` / `offAny()` wildcard event subscription** — `importer.onAny(handler)` receives all domain events regardless of type.
- **`ParsedRecord` type** — new type alias exported from the public API.
- **`count()` method** — `await importer.count()` streams through the source to count total records without modifying import state.
- **`status` field in `getStatus()` result** — `getStatus()` now returns both `status` and `state` (deprecated).
- **`itemTransform` on `FieldDefinition`** — for `type: 'array'` fields, applies a transform to each element after splitting.
- **`GenerateTemplateOptions`** type exported from the public API.
- **`ImportStatusResult`** type exported from the public API.

### Deprecated

- **`state` field in `getStatus()` return** — use `status` instead.

## [0.4.0] - 2026-02-15

### Added

- **Retry mechanism** — `maxRetries` (default: `0`) and `retryDelayMs` (default: `1000`) config options.
- **`RecordRetriedEvent`** domain event.
- **`retryCount`** field on `ProcessedRecord`.
- **`BatchSplitter`** domain service.
- **Use cases layer** (`application/usecases/`).
- `isEmptyRow()` function exported from public API.

### Changed

- **BREAKING**: `getFailedRecords()` is now async (returns `Promise<readonly ProcessedRecord[]>`).
- **Performance**: Concurrent batch pool `Array` → `Set<Promise>` for O(1) add/delete.
- **Performance**: Batch lookup uses `batchIndexById` Map for O(1) access.
- **Performance**: `InMemoryStateStore.saveProcessedRecord()` uses `Map<number, ProcessedRecord>`.
- **Performance**: `FileStateStore.saveProcessedRecord()` uses an in-memory Map cache.
- **Refactor**: `isEmptyRow()` consolidated into a single function.
- **Refactor**: MIME type detection extracted to shared `detectMimeType()` utility.
- **Resilience**: `EventBus.emit()` now wraps handler calls in try/catch.

### Removed

- `updateBatch()` function from `Batch.ts`.

## [0.3.0] - 2026-02-15

### Added

- **`maxConcurrentBatches`** — real batch concurrency via `Promise.race` pool.
- **`BulkImport.restore(jobId, config)`** — static method to resume interrupted imports.
- **Full StateStore integration**.
- **`FileStateStore`** — JSON-on-disk persistent state store.
- **`XmlParser`** — zero-dependency XML parser.
- **`UrlSource`** — fetch-based data source with streaming body support.

## [0.2.2] - 2026-02-15

### Changed

- **BREAKING**: Minimum Node.js version raised from 16.7 to 20.0.
- CI: release workflows upgrade npm for OIDC Trusted Publishing support.
- CI: dropped Node 18 from test matrix.

## [0.2.1] - 2026-02-15

### Changed

- CI: release workflows use `--ignore-scripts` to prevent OIDC token timeout during publish.
- CI: release-state-sequelize switched from NPM_TOKEN to OIDC Trusted Publisher provenance.
- CI: added Dependabot configuration.

## [0.2.0] - 2026-02-15

### Added

- **`@bulkimport/state-sequelize`** — new subpackage implementing `StateStore` port with Sequelize v6.
- `BatchState` type exported from `@bulkimport/core`.
- npm workspaces configured at root for monorepo subpackages.
- **Array field type**.
- **Column aliases**.
- **Unique field duplicate detection**.
- `JsonParser` adapter.
- `FilePathSource` adapter.
- `StreamSource` adapter.
- `skipEmptyRows` support in `SchemaValidator`.
- `BulkImport.generateTemplate(schema)`.
- JSDoc on all public API types, interfaces, methods, and ports.

### Removed

- `markRecordProcessed()` function from `Record.ts`.

## [0.1.0] - 2025-02-13

### Added

- Initial release of `@bulkimport/core`.
- `BulkImport` facade with streaming batch processing.
- `CsvParser` adapter (via PapaParse).
- `BufferSource` adapter.
- `InMemoryStateStore` adapter.
- Schema validation pipeline (string, number, boolean, date, email, custom validators).
- Pause/resume/abort with AbortController.
- Preview with sampling.
- Domain events with typed EventBus.
- O(1) progress tracking with counters.
- Memory release via `clearBatchRecords()` after each batch.
- GitHub Actions CI/CD (lint, typecheck, test matrix, build, npm publish via OIDC).
