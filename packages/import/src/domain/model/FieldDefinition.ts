/** Supported field types for schema validation. */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'email' | 'array' | 'custom';

/** Result returned by a custom field validator. */
export interface ValidationFieldResult {
  valid: boolean;
  message?: string;
  /** Override severity for this validation result. Defaults to `'error'`. */
  severity?: 'error' | 'warning';
  /** Actionable hint for the user to fix the error. */
  suggestion?: string;
  /** Additional structured data about the validation result. */
  metadata?: Record<string, unknown>;
}

/** Defines a single field in the import schema. */
export interface FieldDefinition {
  /** Column name to match in the source data. */
  readonly name: string;
  /** Built-in type validation applied to this field's value. */
  readonly type: FieldType;
  /** When `true`, the field must be present and non-empty. */
  readonly required: boolean;
  /** Regex pattern the value must match (applied after type validation). */
  readonly pattern?: RegExp;
  /** Custom validation function for `type: 'custom'` fields. */
  readonly customValidator?: (value: unknown) => ValidationFieldResult;
  /** Transform function applied to the value during `applyTransforms()`. */
  readonly transform?: (value: unknown) => unknown;
  /** Default value applied when the field is `undefined`. */
  readonly defaultValue?: unknown;
  /** For `'array'` type: separator used to split the string value. Default: `','`. */
  readonly separator?: string;
  /** For `'array'` type: transform applied to each element after splitting (e.g. `(s) => s.trim().toLowerCase()`). */
  readonly itemTransform?: (item: string) => string;
  /** Alternative column names that map to this field's canonical name. Case-insensitive. */
  readonly aliases?: readonly string[];
}
