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
2. Make sure all checks pass: `npm run typecheck && npm run lint && npm test`
3. Write/update tests for your changes
4. Keep PRs focused — one feature or fix per PR
5. Update the README if adding public API surface

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
