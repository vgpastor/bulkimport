import type { FieldDefinition } from './FieldDefinition.js';

export interface SchemaDefinition {
  readonly fields: readonly FieldDefinition[];
  readonly strict?: boolean;
  readonly skipEmptyRows?: boolean;
}
