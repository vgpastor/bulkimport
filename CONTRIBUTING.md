# Contributing to @bulkimport/core

Thanks for your interest in contributing! This document covers how to set up the project, the coding standards we follow, and how to submit changes.

## Getting Started

```bash
# Clone the repo
git clone <repo-url>
cd bulkimport

# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format
```

## Project Structure

```
src/
├── domain/           # Pure domain — zero external dependencies
│   ├── model/        # Entities, value objects, state machines
│   ├── ports/        # Interfaces (DataSource, SourceParser, StateStore, RecordProcessor)
│   ├── events/       # Domain events
│   └── services/     # Domain services (SchemaValidator)
├── application/      # Application layer (EventBus)
├── infrastructure/   # Concrete adapters (CsvParser, BufferSource, InMemoryStateStore)
├── BulkImport.ts     # Main facade
└── index.ts          # Public API exports
```

### Layer Rules

These rules are non-negotiable:

- **`domain/`** must NOT import from `application/`, `infrastructure/`, or any external package.
- **`application/`** may import from `domain/` only.
- **`infrastructure/`** implements `domain/ports/` interfaces and may use external packages.
- **`BulkImport.ts`** is the composition root.
- **`index.ts`** is the public API surface. Every export is intentional — adding or removing exports is a breaking change.

## Design Principles

We follow these principles strictly, in order of priority:

1. **Outside-In development** — Acceptance tests first, then unit tests. Tests drive the design.
2. **DDD** — Business rules live in `domain/`. No framework leaks.
3. **SOLID** — Small interfaces, depend on abstractions, single responsibility.
4. **Clean Code** — Meaningful names, small functions, no unnecessary comments, early returns.
5. **Immutability** — All types use `readonly`. Transform through pure functions, never mutate.

## Coding Standards

### TypeScript

- Strict mode is enforced. No `any` — use `unknown` when needed.
- Use `type` imports for types erased at runtime: `import type { Foo } from './foo.js'`.
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Use `as const` objects + derived types instead of TypeScript enums.
- No classes in domain model — use interfaces + factory functions. Classes are fine for services and adapters.

### Naming

- **Files**: PascalCase for types/classes (`ImportStatus.ts`)
- **Types/Interfaces**: PascalCase, no `I` prefix
- **Functions**: camelCase, verb-first (`createBatch`, `markRecordValid`)
- **Events**: `namespace:action` format (`import:started`, `batch:completed`)

## Testing

### Strategy

- **Acceptance tests** (`tests/acceptance/`): Full workflows through the `BulkImport` facade. These are the primary tests. Write these FIRST for any new feature.
- **Unit tests** (`tests/unit/`): Domain logic in isolation.
- Use test doubles (mocks/stubs) for **ports only**, never for implementations.

### Commands

```bash
npm test              # Single run
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

### Coverage Targets

- Domain layer: 90%
- Global: 80%

### Writing Tests

- `describe` blocks named after the unit or scenario
- Test names describe expected behavior: `"should skip invalid records when continueOnError is true"`
- Helper functions at the top of test files
- No test should depend on another test's state

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add JsonParser adapter
fix: percentage calculation includes failed records
refactor: extract BatchSplitter domain service
test: add acceptance test for restore from StateStore
docs: add custom adapter examples to README
```

Prefix with: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

## Pull Requests

1. Create a feature branch from `main`
2. Make sure all checks pass: `npm run typecheck && npm run lint && npm test && npm run build`
3. Write/update tests for your changes
4. Keep PRs focused — one feature or fix per PR
5. **Update documentation** (see checklist below)

### Documentation checklist

Before marking a PR as ready for review, verify:

- [ ] **`README.md`** — Updated if the PR adds, changes, or removes public API (methods, config options, adapters, events). Usage examples must reflect the current API.
- [ ] **`CHANGELOG.md`** — Entry added under `[Unreleased]` describing the change. Use `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` categories.
- [ ] **`todo.md`** — Completed items marked as `[x]`, new items added if discovered during implementation.

Documentation drift is a bug. A PR that changes behavior without updating docs is incomplete.

## Breaking Changes & Versioning

This is a public library. Our users depend on the stability of the API. **Breaking their code without warning is unacceptable.**

### What counts as a breaking change

- Removing or renaming any export from `index.ts` (functions, classes, types, interfaces).
- Changing the signature of a public method (adding required params, changing return/param types).
- Changing the shape of a public interface or type (removing fields, changing field types).
- Renaming event names or changing event payload shapes.
- Changing observable behavior of a public method (e.g., sync to async, different return value).
- Removing or renaming config options in `BulkImportConfig` or `SchemaDefinition`.

### Deprecation-first rule

**NEVER remove or change public API directly.** Always follow this two-step process:

1. **Deprecate first** (in a minor or patch release):
   - Add `@deprecated` JSDoc with the target removal version and migration path.
   - Keep the old API working alongside the new one.
   - Emit a runtime warning on first use: `"[bulkimport] oldMethod() is deprecated and will be removed in vX.0.0. Use newMethod() instead."`
   - Document in CHANGELOG.
   - Existing tests for the deprecated API must keep passing.

2. **Remove in the next major version**:
   - Remove the deprecated code.
   - Update exports, README, and CHANGELOG.
   - Bump major version.

### Semver

- **Patch** (`0.1.x`): Bug fixes, performance, internal refactors, docs. No API changes.
- **Minor** (`0.x.0`): New features, new exports, new config options. Existing code keeps working. Deprecations go here.
- **Major** (`x.0.0`): Removal of deprecated APIs. Must be preceded by a minor with deprecations.

> During pre-1.0 (`0.x.y`), semver allows breaking changes in minor versions. We still **strongly prefer** the deprecation-first approach. If unavoidable, breaking changes MUST include a migration guide in the CHANGELOG.

### Before submitting a PR

Ask yourself: _"Will this change break code that currently works for a consumer?"_ If yes, follow the deprecation-first rule. If unsure, open an issue to discuss before coding.

## Adding a New Adapter

To add a new parser, data source, or state store:

1. Create the adapter in `src/infrastructure/` implementing the corresponding port from `src/domain/ports/`
2. Write unit tests in `tests/unit/infrastructure/`
3. Add an acceptance test if the adapter enables a new workflow
4. Export it from `src/index.ts`
5. Document it in the README

## Reporting Issues

When reporting bugs, include:

- Node.js version
- Package version
- Minimal reproduction (code snippet or repo)
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
