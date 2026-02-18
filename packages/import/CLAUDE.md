# CLAUDE.md — @batchactions/import

## Package Overview

Import-specific layer for `@batchactions/core`. Provides schema validation, parsers (CSV, JSON, XML), template generation, and the `BulkImport` facade. This package extends the generic batch engine with data import concerns.

## Architecture

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

- Same hexagonal architecture as `@batchactions/core`.
- `BulkImport.ts` is the composition root — wraps `BatchEngine` with schema validation and parsers.
- `index.ts` re-exports commonly used types from `@batchactions/core` for convenience.

## Dependencies

- **Peer dependency**: `@batchactions/core` (>= 0.0.1)
- **Runtime dependency**: `papaparse` (CSV parsing)

## Public API

- `BulkImport` class + `BulkImportConfig`, `GenerateTemplateOptions` types
- Schema types: `SchemaDefinition`, `FieldDefinition`, `FieldType`, `ValidationFieldResult`, `PreviewResult`
- `SchemaValidator` domain service
- Ports: `SourceParser`, `ParserOptions`, `DuplicateChecker`, `DuplicateCheckResult`
- Built-in parsers: `CsvParser`, `JsonParser`, `XmlParser`
- Re-exports from `@batchactions/core`

## Testing

```bash
npm test -w packages/import
```

- **Acceptance tests** (`tests/acceptance/`): Full import workflows with CSV/JSON/XML, schema validation, edge cases.
- **Unit tests** (`tests/unit/`): SchemaValidator, parsers, aliases, array fields, duplicate detection.
- Config: `vitest.config.ts` with alias `@batchactions/core` → `../core/src/index.ts`.

## Build

```bash
npm run build -w packages/import
```

Requires `@batchactions/core` to be built first. Dual format: ESM + CJS + `.d.ts` via `tsup`.
