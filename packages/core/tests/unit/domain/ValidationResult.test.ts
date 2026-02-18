import { describe, it, expect } from 'vitest';
import {
  hasErrors,
  getWarnings,
  getErrors,
  validResult,
  invalidResult,
} from '../../../src/domain/model/ValidationResult.js';
import type { ValidationError } from '../../../src/domain/model/ValidationResult.js';

describe('ValidationResult helpers', () => {
  describe('hasErrors', () => {
    it('should return true when errors contain a hard error (severity undefined)', () => {
      const errors: ValidationError[] = [{ field: 'a', message: 'required', code: 'REQUIRED' }];
      expect(hasErrors(errors)).toBe(true);
    });

    it('should return true when errors contain severity error', () => {
      const errors: ValidationError[] = [{ field: 'a', message: 'bad', code: 'TYPE_MISMATCH', severity: 'error' }];
      expect(hasErrors(errors)).toBe(true);
    });

    it('should return false when all errors are warnings', () => {
      const errors: ValidationError[] = [
        { field: 'a', message: 'warn', code: 'CUSTOM_VALIDATION', severity: 'warning' },
        { field: 'b', message: 'also warn', code: 'CUSTOM_VALIDATION', severity: 'warning' },
      ];
      expect(hasErrors(errors)).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(hasErrors([])).toBe(false);
    });

    it('should return true for mix of warnings and errors', () => {
      const errors: ValidationError[] = [
        { field: 'a', message: 'warn', code: 'CUSTOM_VALIDATION', severity: 'warning' },
        { field: 'b', message: 'err', code: 'REQUIRED', severity: 'error' },
      ];
      expect(hasErrors(errors)).toBe(true);
    });
  });

  describe('getWarnings', () => {
    it('should filter only warnings', () => {
      const errors: ValidationError[] = [
        { field: 'a', message: 'err', code: 'REQUIRED', severity: 'error' },
        { field: 'b', message: 'warn', code: 'CUSTOM_VALIDATION', severity: 'warning' },
        { field: 'c', message: 'implicit err', code: 'TYPE_MISMATCH' },
      ];
      const warnings = getWarnings(errors);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.field).toBe('b');
    });

    it('should return empty array when no warnings', () => {
      const errors: ValidationError[] = [{ field: 'a', message: 'err', code: 'REQUIRED' }];
      expect(getWarnings(errors)).toHaveLength(0);
    });
  });

  describe('getErrors', () => {
    it('should include errors with severity error', () => {
      const errors: ValidationError[] = [
        { field: 'a', message: 'err', code: 'REQUIRED', severity: 'error' },
        { field: 'b', message: 'warn', code: 'CUSTOM_VALIDATION', severity: 'warning' },
      ];
      const hardErrors = getErrors(errors);
      expect(hardErrors).toHaveLength(1);
      expect(hardErrors[0]?.field).toBe('a');
    });

    it('should include errors with undefined severity (backward compatible)', () => {
      const errors: ValidationError[] = [
        { field: 'a', message: 'err', code: 'REQUIRED' },
        { field: 'b', message: 'warn', code: 'CUSTOM_VALIDATION', severity: 'warning' },
      ];
      const hardErrors = getErrors(errors);
      expect(hardErrors).toHaveLength(1);
      expect(hardErrors[0]?.field).toBe('a');
    });

    it('should return empty array when all are warnings', () => {
      const errors: ValidationError[] = [
        { field: 'a', message: 'warn', code: 'CUSTOM_VALIDATION', severity: 'warning' },
      ];
      expect(getErrors(errors)).toHaveLength(0);
    });
  });

  describe('validResult / invalidResult', () => {
    it('should create a passing result', () => {
      const result = validResult();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should create a failing result with errors', () => {
      const errors: ValidationError[] = [{ field: 'a', message: 'err', code: 'REQUIRED', category: 'VALIDATION' }];
      const result = invalidResult(errors);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.category).toBe('VALIDATION');
    });
  });
});
