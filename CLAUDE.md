# CLAUDE.md — @bulkimport/core

## Project Overview

Public npm library (`@bulkimport/core`) for backend-agnostic bulk data import with schema validation, batch processing, and state management. Designed to be consumed by any TypeScript/JavaScript project regardless of framework or runtime. Must work in both Node.js and browsers (parsing/validation; not file persistence).

## Architecture

Hexagonal Architecture (Ports & Adapters) with DDD tactical patterns.

```
src/
├── domain/           # Pure domain — zero external dependencies
│   ├── model/        # Entities, value objects, state machines (all immutable)
│   ├── ports/        # Interfaces: DataSource, SourceParser, StateStore, RecordProcessorFn
│   ├── events/       # Domain events (discriminated unions)
│   └── services/     # Domain services (SchemaValidator)
├── application/      # Application layer (EventBus)
├── infrastructure/   # Concrete adapters (CsvParser, BufferSource, InMemoryStateStore)
└── BulkImport.ts     # Facade — orchestrates the import lifecycle
```

### Target architecture (spec)

The spec envisions a richer `application/` layer with explicit use cases:

```
src/application/usecases/
├── CreateImportJob.ts
├── PreviewImport.ts
├── StartImport.ts
├── PauseImport.ts
├── ResumeImport.ts
├── AbortImport.ts
└── GetImportStatus.ts
```

And a `BatchSplitter` domain service alongside `SchemaValidator`. Currently the facade (`BulkImport.ts`) absorbs all orchestration. Extracting use cases is a future refactor — see `todo.md`.

### Layer rules

- `domain/` MUST NOT import from `application/`, `infrastructure/`, or external packages.
- `application/` may import from `domain/` only.
- `infrastructure/` implements `domain/ports/` interfaces and may use external packages.
- `BulkImport.ts` is the composition root — wires everything together.
- `index.ts` is the public API surface — every export is intentional.

### Key domain concepts

- **ImportStatus**: Finite state machine with explicit valid transitions (`canTransition()`). Terminal states: COMPLETED, ABORTED, FAILED.
- **Batch**: Immutable grouping of records. Processed sequentially.
- **ProcessedRecord**: Immutable record that progresses through statuses: pending → valid/invalid → processed/failed.
- **SchemaDefinition**: Declares fields with types, required flag, pattern, custom validator, transform, and default value.
- **Domain Events**: Typed with discriminated unions. `EventPayload<T>` extracts the correct event type.

## Design Principles

Strictly follow these principles in order of priority:

1. **Outside-In development (London School)** — Start from acceptance tests that describe behavior from the consumer's perspective, then drill into unit tests for domain logic. Use doubles for ports (interfaces), never for implementations. The acceptance test is the living contract of the public API.
2. **DDD** — Domain model is the core. Business rules live in `domain/`. No framework or infrastructure leaks into the domain. Respect bounded contexts and ubiquitous language: ImportJob, Batch, Record, Schema, ValidationResult.
3. **SOLID** — Single responsibility per file/class. Depend on abstractions (ports), not concretions. Open for extension via new adapters. Interfaces are small and specific — consumers should not depend on methods they don't use.
4. **Clean Code** — Small functions, meaningful names, no comments that restate the code. No magic numbers or strings. Early returns over deep nesting. If code needs a comment, refactor it.
5. **Immutability** — All types use `readonly`. Records transform through pure functions, never mutation.

## Mandatory Post-Change Checklist

After every implementation task, **before considering the task complete**, verify:

1. **Run the full pipeline**: `npm run typecheck && npm run lint && npm run test && npm run build`
2. **Update `todo.md`**: Mark completed items as `[x]`, add new items discovered during implementation.
3. **Update `CLAUDE.md`**: If the change affects architecture, public API, known gaps, or technical decisions — update the relevant sections. Remove resolved gaps from "Current State & Known Gaps".
4. **Update `README.md`**: If the change modifies or adds to the public API (new methods, new config options, new adapters), update usage examples and API reference.

This checklist is non-negotiable. Documentation drift is a bug.

## Coding Conventions

### TypeScript

- Strict mode: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- Use `type` imports (`import type { ... }`) for types that are erased at runtime.
- Prefer `interface` for object shapes, `type` for unions and intersections.
- Use `as const` objects + derived type for enums (see `ImportStatus.ts`, `BatchStatus.ts`).
- No `any`. Use `unknown` when the type is genuinely unknown.
- No classes in domain model — use plain interfaces + factory functions (e.g., `createBatch()`, `createPendingRecord()`). Classes are acceptable for services (`SchemaValidator`) and infrastructure adapters.
- Barrel exports in `index.ts` only. No intermediate barrel files.

### Naming

- Files: PascalCase for types/classes (`ImportStatus.ts`), camelCase for pure function modules if needed.
- Types/Interfaces: PascalCase, no `I` prefix.
- Functions: camelCase, verb-first (`createBatch`, `markRecordValid`, `canTransition`).
- Events: namespace:action format (`import:started`, `batch:completed`, `record:failed`).
- Constants: PascalCase object with `as const` (not SCREAMING_SNAKE).

### File structure

- One concept per file. `Record.ts` contains the record type and all its transition functions.
- Ports are one interface per file.
- Domain events are all in a single file (`DomainEvents.ts`) since they form a discriminated union.

## Testing

### Strategy

- **Acceptance tests** (`tests/acceptance/`): Test full workflows through the `BulkImport` facade. These are the primary tests — they validate behavior from the consumer's perspective. Write these FIRST.
- **Unit tests** (`tests/unit/`): Test domain logic in isolation (SchemaValidator, ImportStatus state machine, EventBus).
- Use doubles (mocks/stubs) for ports (interfaces), never for implementations.
- No mocks for domain logic. Mocks only for infrastructure boundaries when needed.
- Coverage targets: 90% domain, 80% global.

### Running tests

```bash
npm test              # vitest run (single run)
npm run test:watch    # vitest (watch mode)
npm run test:coverage # vitest run --coverage
npm run typecheck     # tsc --noEmit
```

### Test conventions

- Use `describe` blocks named after the unit or scenario.
- Test names describe expected behavior: `"should skip invalid records and track failures when continueOnError is true"`.
- Helpers at the top of test files (e.g., `generateCsv()`, `createImporter()`).
- No test should depend on another test's state.

## Build & Publish

```bash
npm run build    # tsup → dist/ (ESM + CJS + .d.ts)
```

- Dual format: ESM (`.mjs`) + CJS (`.cjs`) with TypeScript declarations.
- Only `dist/` is published (`"files": ["dist"]`).
- Path aliases (`@domain/*`, `@application/*`, `@infrastructure/*`) are for dev/test only — not used in source code (all imports are relative).
- Target: ES2020 for maximum compatibility (Node 20+, modern browsers).
- `globalThis.crypto.randomUUID()` requires Node.js >= 20 (global `crypto` stable since Node 20).

## Public API Surface

Everything exported from `index.ts` is public API. Changes to exports are breaking changes. The public API consists of:

- `BulkImport` class + `BulkImportConfig` type (main entry point)
- Domain model types (exported as `type` — no runtime footprint)
- `ImportStatus` and `BatchStatus` value enums (runtime exports)
- Port interfaces (for consumers implementing custom adapters)
- Domain event types (for typed event handlers)
- Built-in parsers: `CsvParser`, `JsonParser`, `XmlParser`
- Built-in sources: `BufferSource`, `FilePathSource`, `StreamSource`, `UrlSource`
- Built-in state stores: `InMemoryStateStore`, `FileStateStore`

## Breaking Changes Policy

**Read and follow the "Breaking Changes & Versioning" section in `CONTRIBUTING.md`.** That is the canonical source for semver rules, deprecation-first protocol, and what counts as a breaking change.

Key rule: **NEVER remove or change public API directly.** Always deprecate first (`@deprecated` + runtime `console.warn`), then remove in the next major version.

## Technical Decisions

- **Streaming obligatory**: Never load the entire file in memory. Use `AsyncIterable` / `ReadableStream` to process record by record. This allows handling files with millions of records.
- **AbortController for pause/resume**: Use native `AbortController` for cancellation signals. Pause is implemented by resolving a Promise that stays pending until `resume()` is called.
- **Typed Event Emitter**: No `any`. Each event has its own payload type via discriminated unions.
- **Zero dependencies in domain**: The domain layer has NO external dependencies. Adapters (infrastructure) may use PapaParse, fast-xml-parser, etc.
- **ID generation**: Use `crypto.randomUUID()` (native Node 20+ and modern browsers).
- **Error boundaries**: Each batch runs inside try/catch. A failing batch does not stop others when `continueOnError: true`. Consumer processor errors are captured in the record, never propagated to the engine.

## Scope Boundaries — What This Library Does NOT Do

- Does NOT expose HTTP endpoints. It is a library, not a server.
- Does NOT have a UI. Logic and data only.
- Does NOT choose a database. The consumer decides via the processor callback.
- Does NOT parse binary formats (Excel, etc.) in MVP. Text only: CSV, JSON, XML.
- Does NOT do automatic column mapping. The schema defines expectations. Mapping is the consumer's responsibility.
- Does NOT retain data in memory. Records pass through the callback and are discarded once processed (except what the StateStore persists).

## Current State & Known Gaps

Published as `@bulkimport/core@0.2.2`. CI/CD configured with GitHub Actions (lint, typecheck, test matrix Node 18/20/22, build) and npm publish via OIDC Trusted Publisher.

### Implemented

- Streaming batch processing — `start()` parses lazily and processes batch-by-batch, never loading all records in memory.
- `maxConcurrentBatches` — real batch concurrency via `Promise.race` pool. Default: 1 (sequential). Set > 1 for parallel batch processing.
- O(1) progress tracking with counters. Percentage includes both processed and failed records.
- Memory release — `clearBatchRecords()` frees record data after each batch completes.
- Full StateStore integration — `BulkImport` now calls `saveProcessedRecord()` for every record and `updateBatchState()` for batch transitions. State is persisted after each batch for crash recovery.
- `BulkImport.restore(jobId, config)` — static method to resume interrupted imports. Rebuilds counters from persisted state and skips already-completed batches.
- Full validation pipeline (string, number, boolean, date, email, array, custom validators).
- Array field type with configurable separator — strings are auto-split in `applyTransforms()`.
- Column aliases — case-insensitive header mapping via `resolveAliases()` on `SchemaValidator`.
- Unique field duplicate detection — cross-batch tracking via `seenUniqueValues` Map, case-insensitive for strings.
- Pause/resume/abort with AbortController.
- Preview with sampling.
- Domain events with typed EventBus.
- `skipEmptyRows` in `SchemaValidator` — filters empty rows before validation in both `start()` and `preview()`.
- ESLint 9 flat config + Prettier configured and enforced.
- JSDoc on all public API types, interfaces, methods, and ports.
- `BulkImport.generateTemplate(schema)` — generate CSV header from schema.
- CHANGELOG maintained with Keep a Changelog format.
- 186 acceptance + unit tests passing (including concurrency, state persistence, restore, XML import, edge cases).
- npm workspaces configured for monorepo subpackages (`packages/*`).
- Built-in parsers: `CsvParser`, `JsonParser`, `XmlParser`.
- Built-in sources: `BufferSource`, `FilePathSource`, `StreamSource`, `UrlSource`.
- Built-in state stores: `InMemoryStateStore`, `FileStateStore`.

### Subpackages

- **`@bulkimport/state-sequelize`** (`packages/state-sequelize/`) — Sequelize v6 adapter for the `StateStore` port. Persists job state and records to SQL databases. 40 tests (19 unit + 21 integration with SQLite in-memory). Separate npm package with `peerDependencies` on `@bulkimport/core` and `sequelize`.

### Known Gaps

- `application/usecases/` layer not extracted — all orchestration lives in `BulkImport` facade.
- No retry mechanism for failed records.

See `todo.md` for the full prioritized backlog.
