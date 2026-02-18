/** Error codes produced by schema validation. */
export type ValidationErrorCode =
  | 'REQUIRED'
  | 'TYPE_MISMATCH'
  | 'PATTERN_MISMATCH'
  | 'CUSTOM_VALIDATION'
  | 'UNKNOWN_FIELD'
  | 'DUPLICATE_VALUE'
  | 'EXTERNAL_DUPLICATE';

/** Severity level of a validation error. Warnings are non-blocking. */
export type ErrorSeverity = 'error' | 'warning';

/** Category grouping for validation errors. */
export type ErrorCategory = 'VALIDATION' | 'FORMAT' | 'DUPLICATE' | 'PROCESSING' | 'CUSTOM';

/** A single validation error for a specific field. */
export interface ValidationError {
  /** Name of the field that failed validation. */
  readonly field: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Machine-readable error code. */
  readonly code: ValidationErrorCode;
  /** The value that caused the validation failure. */
  readonly value?: unknown;
  /** Severity level. Defaults to `'error'` when omitted. Warnings are non-blocking. */
  readonly severity?: ErrorSeverity;
  /** Broad category grouping (e.g. `'VALIDATION'`, `'FORMAT'`). */
  readonly category?: ErrorCategory;
  /** Actionable hint for the user to fix the error. */
  readonly suggestion?: string;
  /** Additional structured data about the error (e.g. allowed values, thresholds). */
  readonly metadata?: Record<string, unknown>;
}

/** Result of validating a single record against the schema. */
export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly ValidationError[];
  /**
   * Optionally holds the transformed/parsed version of the record.
   * When provided, the core engine uses this as the parsed data
   * instead of the raw input.
   */
  readonly parsed?: Record<string, unknown>;
}

/** Create a passing validation result, optionally carrying transformed data. */
export function validResult(parsed?: Record<string, unknown>): ValidationResult {
  return parsed !== undefined ? { isValid: true, errors: [], parsed } : { isValid: true, errors: [] };
}

/** Create a failing validation result with the given errors. */
export function invalidResult(errors: readonly ValidationError[]): ValidationResult {
  return { isValid: false, errors };
}

/** Return `true` if the list contains at least one hard error (severity `'error'` or unset). */
export function hasErrors(errors: readonly ValidationError[]): boolean {
  return errors.some((e) => e.severity === undefined || e.severity === 'error');
}

/** Filter to only warning-level errors. */
export function getWarnings(errors: readonly ValidationError[]): readonly ValidationError[] {
  return errors.filter((e) => e.severity === 'warning');
}

/** Filter to only hard errors (severity `'error'` or unset). */
export function getErrors(errors: readonly ValidationError[]): readonly ValidationError[] {
  return errors.filter((e) => e.severity === undefined || e.severity === 'error');
}
