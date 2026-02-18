# @batchactions/import

High-level import facade for `@batchactions/core`.

This package is the default entry point when building CSV, JSON, or XML import flows with schema validation and lifecycle hooks.

## Install

```bash
npm install @batchactions/import @batchactions/core
```

## What You Get

- `BulkImport` facade for end-to-end import workflows
- Schema validation with required fields, patterns, transforms, aliases, and custom validators
- Built-in parsers: `CsvParser`, `JsonParser`, `XmlParser`
- Preview mode before processing
- Template generation via `BulkImport.generateTemplate()`
- Optional duplicate checks against external systems (`DuplicateChecker`)

## Quick Start

```typescript
import { BulkImport, CsvParser, BufferSource } from '@batchactions/import';

const importer = new BulkImport({
  schema: {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'age', type: 'number' },
    ],
  },
  batchSize: 500,
  continueOnError: true,
});

importer.from(new BufferSource('email,age\nuser@example.com,30'), new CsvParser());

const preview = await importer.preview(10);
console.log(preview.validRecords, preview.invalidRecords);

await importer.start(async (record) => {
  await saveUser(record);
});
```

## Template Generation

```typescript
import { BulkImport } from '@batchactions/import';

const csvTemplate = BulkImport.generateTemplate(
  {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'string', required: true },
    ],
  },
  { exampleRows: 2 },
);
```

## Main Exports

- `BulkImport`
- `SchemaValidator`
- `CsvParser`, `JsonParser`, `XmlParser`
- `SchemaDefinition`, `FieldDefinition`, `PreviewResult`
- Re-exports of common `@batchactions/core` types and adapters

For full typed exports, see `packages/import/src/index.ts`.

## Compatibility

- Node.js >= 20.0.0
- Peer dependency: `@batchactions/core` >= 0.0.1

## Links

- Repository: https://github.com/vgpastor/batchactions/tree/main/packages/import
- Issues: https://github.com/vgpastor/batchactions/issues
- Contributing guide: https://github.com/vgpastor/batchactions/blob/main/CONTRIBUTING.md

## License

MIT
