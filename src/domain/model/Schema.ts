import type { FieldDefinition } from './FieldDefinition.js';

export interface SchemaDefinition {
  readonly fields: readonly FieldDefinition[];
  readonly strict?: boolean;
  readonly skipEmptyRows?: boolean;
  /** Field names that must be unique across the entire import. Duplicates produce validation errors. */
  readonly uniqueFields?: readonly string[];
}
