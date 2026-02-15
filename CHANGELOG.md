# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
