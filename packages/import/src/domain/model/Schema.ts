import type { FieldDefinition } from './FieldDefinition.js';

/** Top-level schema definition for an import job. */
export interface SchemaDefinition {
  /** Ordered list of field definitions. */
  readonly fields: readonly FieldDefinition[];
  /** When `true`, reject records containing fields not defined in the schema. */
  readonly strict?: boolean;
  /** When `true`, rows where all values are empty/null/undefined are silently skipped. */
  readonly skipEmptyRows?: boolean;
  /** Field names that must be unique across the entire import. Duplicates produce `DUPLICATE_VALUE` validation errors. */
  readonly uniqueFields?: readonly string[];
}
