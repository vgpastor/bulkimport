export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'email' | 'custom';

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
}
