export type ValidationErrorCode =
  | 'REQUIRED'
  | 'TYPE_MISMATCH'
  | 'PATTERN_MISMATCH'
  | 'CUSTOM_VALIDATION'
  | 'UNKNOWN_FIELD'
  | 'DUPLICATE_VALUE';

export interface ValidationError {
  readonly field: string;
  readonly message: string;
  readonly code: ValidationErrorCode;
  readonly value?: unknown;
}

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly ValidationError[];
}

export function validResult(): ValidationResult {
  return { isValid: true, errors: [] };
}

export function invalidResult(errors: readonly ValidationError[]): ValidationResult {
  return { isValid: false, errors };
}
