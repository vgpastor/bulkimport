export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'email' | 'array' | 'custom';

export interface ValidationFieldResult {
  valid: boolean;
  message?: string;
}

export interface FieldDefinition {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly pattern?: RegExp;
  readonly customValidator?: (value: unknown) => ValidationFieldResult;
  readonly transform?: (value: unknown) => unknown;
  readonly defaultValue?: unknown;
  /** For 'array' type: separator used to split the string value. Default: ',' */
  readonly separator?: string;
  /** Alternative column names that map to this field's canonical name. */
  readonly aliases?: readonly string[];
}
