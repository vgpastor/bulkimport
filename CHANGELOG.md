# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-02-16

### Added

- **Deferred `import:started` event** — the event is now emitted after yielding to the microtask queue (`await Promise.resolve()`), so handlers registered after `start()` on the same tick receive it. Previously, the event fired synchronously inside `start()`, making it impossible to catch with late-registered handlers.
- **`generateTemplate()` with example rows** — `BulkImport.generateTemplate(schema, { exampleRows: 2 })` generates a CSV with synthetic data rows. Each field type produces appropriate example values: fake emails for `type: 'email'`, ISO dates for `type: 'date'`, numbers for `type: 'number'`, etc. Fields with `defaultValue` use that value instead.
- **`onAny()` / `offAny()` wildcard event subscription** — `importer.onAny(handler)` receives all domain events regardless of type. Simplifies SSE/WebSocket relay where every event must be forwarded. Wildcard handlers are isolated (errors don't propagate).
- **`ParsedRecord` type** — new type alias exported from the public API. Semantically distinct from `RawRecord`: values may have been split (arrays), transformed, or had defaults applied. `RecordProcessorFn` callback now receives `ParsedRecord` instead of `RawRecord`. Non-breaking: types are structurally identical.
- **`count()` method** — `await importer.count()` streams through the source to count total records without modifying import state. Useful for progress bar initialization before calling `start()`.
- **`status` field in `getStatus()` result** — `getStatus()` now returns both `status` and `state` (deprecated). The method name `getStatus()` now matches the field name `status`, resolving the naming inconsistency.
- **`itemTransform` on `FieldDefinition`** — for `type: 'array'` fields, `itemTransform: (s) => s.toLowerCase()` applies a transform to each element after splitting. Useful for normalizing array items without a custom `transform` function.
- **`GenerateTemplateOptions`** type exported from the public API.
- **`ImportStatusResult`** type exported from the public API.
- 24 new tests: deferred events (2), generateTemplate (6), onAny wildcard (3), ParsedRecord (1), count (3), getStatus status/state (2), itemTransform (3), EventBus unit tests (4). 300 total tests (was 276).

### Deprecated

- **`state` field in `getStatus()` return** — use `status` instead. The `state` field will be removed in the next major version.

## [0.4.0] - 2026-02-15

### Added

- **Retry mechanism** — `maxRetries` (default: `0`) and `retryDelayMs` (default: `1000`) config options. Only processor failures are retried — validation failures are structural and never retried. Uses exponential backoff: `retryDelayMs * 2^(attempt - 1)`. Each retry emits a `record:retried` event. `retryCount` is tracked on `ProcessedRecord` for both successful and failed records.
- **`RecordRetriedEvent`** domain event — emitted before each retry attempt with `attempt` number, `maxRetries`, and the error from the previous attempt.
- **`retryCount`** field on `ProcessedRecord` — tracks how many retry attempts were made (0 when no retries occurred).
- **`BatchSplitter`** domain service — reusable async generator that groups a record stream into fixed-size batches. Extracted from `StartImport` for testability and reuse.
- **Use cases layer** (`application/usecases/`) — orchestration extracted from `BulkImport` facade into dedicated use case classes: `StartImport`, `PreviewImport`, `PauseImport`, `ResumeImport`, `AbortImport`, `GetImportStatus`. Shared state lives in `ImportJobContext`.
- `isEmptyRow()` function exported from public API (`Record.ts`).
- 276 total tests (was 203): 11 retry tests, 48 use case/coverage tests, 14 infrastructure tests.

### Changed

- **BREAKING**: `getFailedRecords()` is now async (returns `Promise<readonly ProcessedRecord[]>`). Failed records are no longer accumulated in memory — they are delegated to the configured `StateStore`, eliminating unbounded memory growth for imports with high failure rates.
- **Performance**: Concurrent batch pool (`activeBatches`) replaced from `Array` to `Set<Promise>` for O(1) add/delete instead of O(n) `indexOf` + `splice`.
- **Performance**: Batch lookup in `processStreamBatch` and `updateBatchStatus` uses `batchIndexById` Map for O(1) access instead of `findIndex`/`.map()`.
- **Performance**: `InMemoryStateStore.saveProcessedRecord()` uses `Map<number, ProcessedRecord>` internally for O(1) upsert instead of O(n) `findIndex`.
- **Performance**: `FileStateStore.saveProcessedRecord()` uses an in-memory Map cache per job for O(1) upsert, flushed to disk after each write. Eliminates repeated full-array scans.
- **Refactor**: `isEmptyRow()` consolidated into a single function in `Record.ts`. CsvParser and SchemaValidator now share the same implementation.
- **Refactor**: MIME type detection extracted to shared `detectMimeType()` utility. Used by `UrlSource` and `FilePathSource`.
- **Resilience**: `EventBus.emit()` now wraps handler calls in try/catch — a throwing handler no longer prevents other handlers from executing or disrupts the import pipeline.

### Removed

- `updateBatch()` function from `Batch.ts` — was exported but never used anywhere in the codebase.

## [0.3.0] - 2026-02-15

### Added

- **`maxConcurrentBatches`** — real batch concurrency via `Promise.race` pool. Default: `1` (sequential). Set higher to process multiple batches in parallel when the downstream system supports concurrent writes.
- **`BulkImport.restore(jobId, config)`** — static method to resume interrupted imports from persisted state. Rebuilds counters from the `StateStore` and skips already-completed batches on re-run.
- **Full StateStore integration** — `BulkImport` now calls `saveProcessedRecord()` for every record and `updateBatchState()` for batch transitions. State is persisted after each batch for crash recovery. In-memory counters remain the fast path; the store is the durable backup.
- **`FileStateStore`** — JSON-on-disk persistent state store. Each job produces `{jobId}.json` (state) and `{jobId}.records.json` (records). Node.js only.
- **`XmlParser`** — zero-dependency XML parser with auto record-tag detection. Supports standard XML entities and self-closing tags.
- **`UrlSource`** — fetch-based data source with streaming body support, Range-header sampling, timeout control, and MIME type detection from URL extension. Requires `fetch` (Node.js >= 18).
- 17 new acceptance tests: concurrent batches (5), state persistence & restore (7), XML import (4), UrlSource (1 via unit).
- 29 new unit tests: XmlParser (12), FileStateStore (15), UrlSource (14) — some shared with acceptance.
- 203 total tests (was 146).

## [0.2.2] - 2026-02-15

### Changed

- **BREAKING**: Minimum Node.js version raised from 16.7 to 20.0 (`engines.node >= 20.0.0`). Node 18 is EOL and does not expose `globalThis.crypto` by default.
- CI: release workflows upgrade npm for OIDC Trusted Publishing support (requires npm >= 11.5.1).
- CI: dropped Node 18 from test matrix.

## [0.2.1] - 2026-02-15

### Changed

- CI: release workflows use `--ignore-scripts` to prevent OIDC token timeout during publish.
- CI: release-state-sequelize switched from NPM_TOKEN to OIDC Trusted Publisher provenance.
- CI: added Dependabot configuration for automated dependency updates.

## [0.2.0] - 2026-02-15

### Added

- **`@bulkimport/state-sequelize`** — new subpackage implementing `StateStore` port with Sequelize v6. Persists job state and processed records to any SQL database (PostgreSQL, MySQL, SQLite, etc.). Lives in `packages/state-sequelize/` as a separate npm package. 40 tests (unit + integration with SQLite in-memory).
- `BatchState` type exported from `@bulkimport/core` — required by `StateStore` implementors.
- npm workspaces configured at root for monorepo subpackages.
- **Array field type** — declare fields as `{ type: 'array', separator: ';' }` to auto-split comma/custom-separated strings into arrays during `applyTransforms()`. Accepts string or array values. Empty arrays `[]` are treated as empty for required field validation.
- **Column aliases** — declare `aliases: ['correo', 'mail']` on field definitions for case-insensitive header mapping via `resolveAliases()`. Canonical field names are always resolved (even without explicit aliases), enabling case-insensitive header matching.
- **Unique field duplicate detection** — declare `uniqueFields: ['identifier']` on schema to detect duplicate values across the entire import. Cross-batch tracking via `seenUniqueValues` Map. Case-insensitive for strings. Empty values are skipped. Produces `DUPLICATE_VALUE` validation error code.
- `JsonParser` adapter — supports JSON array and NDJSON (newline-delimited JSON) formats with auto-detection. Nested objects are flattened to JSON strings. Zero external dependencies.
- `FilePathSource` adapter — streams files from disk using `createReadStream` with configurable chunk size (`highWaterMark`). Automatic MIME type detection by extension. Node.js only.
- `StreamSource` adapter — accepts `AsyncIterable` or `ReadableStream` as input. Converts Buffer chunks to strings. Protects against double consumption. Ideal for Express/Fastify upload streams.
- `skipEmptyRows` support in `SchemaValidator` — filters empty rows before validation in both `start()` and `preview()`.
- 13 schema-advanced acceptance tests (arrays, aliases, uniqueness, combined features).
- 18 schema-advanced unit tests in `SchemaValidator.test.ts`.
- 22 edge case acceptance tests (empty files, BOM, delimiters, quoted fields, line endings, skipEmptyRows).
- 21 `JsonParser` unit tests + 5 acceptance tests.
- 9 `FilePathSource` unit tests (including integration with BulkImport).
- 8 `StreamSource` unit tests (including integration with BulkImport).
- `BulkImport.generateTemplate(schema)` — static method that generates a CSV header line from schema field names.
- JSDoc on all public API types, interfaces, methods, and ports.
- Documentation checklist in `CONTRIBUTING.md` for pull requests.
- Breaking changes policy with deprecation-first protocol in `CONTRIBUTING.md`.

### Removed

- `markRecordProcessed()` function from `Record.ts` (internal, was not part of public API).

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
