import { describe, it, expect } from 'vitest';
import { SchemaValidator } from '../../../src/domain/services/SchemaValidator.js';
import type { SchemaDefinition } from '../../../src/domain/model/Schema.js';

describe('SchemaValidator', () => {
  describe('required fields', () => {
    const schema: SchemaDefinition = {
      fields: [
        { name: 'email', type: 'string', required: true },
        { name: 'nickname', type: 'string', required: false },
      ],
    };
    const validator = new SchemaValidator(schema);

    it('should fail when a required field is missing', () => {
      const result = validator.validate({ nickname: 'bob' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('REQUIRED');
      expect(result.errors[0]!.field).toBe('email');
    });

    it('should pass when required field is present', () => {
      const result = validator.validate({ email: 'bob@test.com' });
      expect(result.isValid).toBe(true);
    });

    it('should fail when required field is empty string', () => {
      const result = validator.validate({ email: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]!.code).toBe('REQUIRED');
    });
  });

  describe('type validation', () => {
    it('should validate number type', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'age', type: 'number', required: true }],
      });

      expect(validator.validate({ age: '25' }).isValid).toBe(true);
      expect(validator.validate({ age: '3.14' }).isValid).toBe(true);
      expect(validator.validate({ age: 'abc' }).isValid).toBe(false);
      expect(validator.validate({ age: 'abc' }).errors[0]!.code).toBe('TYPE_MISMATCH');
    });

    it('should validate boolean type', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'active', type: 'boolean', required: true }],
      });

      expect(validator.validate({ active: 'true' }).isValid).toBe(true);
      expect(validator.validate({ active: 'false' }).isValid).toBe(true);
      expect(validator.validate({ active: '1' }).isValid).toBe(true);
      expect(validator.validate({ active: '0' }).isValid).toBe(true);
      expect(validator.validate({ active: 'yes' }).isValid).toBe(true);
      expect(validator.validate({ active: 'no' }).isValid).toBe(true);
      expect(validator.validate({ active: 'maybe' }).isValid).toBe(false);
    });

    it('should validate email type', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'email', type: 'email', required: true }],
      });

      expect(validator.validate({ email: 'user@test.com' }).isValid).toBe(true);
      expect(validator.validate({ email: 'not-an-email' }).isValid).toBe(false);
      expect(validator.validate({ email: 'not-an-email' }).errors[0]!.code).toBe('TYPE_MISMATCH');
    });

    it('should validate date type', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'created', type: 'date', required: true }],
      });

      expect(validator.validate({ created: '2024-01-15' }).isValid).toBe(true);
      expect(validator.validate({ created: 'not-a-date' }).isValid).toBe(false);
    });

    it('should accept any value for string type', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'name', type: 'string', required: true }],
      });

      expect(validator.validate({ name: 'anything' }).isValid).toBe(true);
      expect(validator.validate({ name: '12345' }).isValid).toBe(true);
    });
  });

  describe('pattern validation', () => {
    it('should validate against regex pattern', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'role', type: 'string', required: true, pattern: /^(admin|user|editor)$/ }],
      });

      expect(validator.validate({ role: 'admin' }).isValid).toBe(true);
      expect(validator.validate({ role: 'hacker' }).isValid).toBe(false);
      expect(validator.validate({ role: 'hacker' }).errors[0]!.code).toBe('PATTERN_MISMATCH');
    });
  });

  describe('custom validator', () => {
    it('should use custom validator function', () => {
      const validator = new SchemaValidator({
        fields: [
          {
            name: 'nif',
            type: 'custom',
            required: true,
            customValidator: (value) => {
              const valid = /^\d{8}[A-Z]$/.test(String(value));
              return { valid, message: valid ? undefined : 'Invalid NIF' };
            },
          },
        ],
      });

      expect(validator.validate({ nif: '12345678Z' }).isValid).toBe(true);
      expect(validator.validate({ nif: 'INVALID' }).isValid).toBe(false);
      expect(validator.validate({ nif: 'INVALID' }).errors[0]!.code).toBe('CUSTOM_VALIDATION');
      expect(validator.validate({ nif: 'INVALID' }).errors[0]!.message).toBe('Invalid NIF');
    });
  });

  describe('strict mode', () => {
    it('should reject unknown fields in strict mode', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'name', type: 'string', required: true }],
        strict: true,
      });

      const result = validator.validate({ name: 'Alice', unknownField: 'value' });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]!.code).toBe('UNKNOWN_FIELD');
    });

    it('should allow unknown fields in non-strict mode', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'name', type: 'string', required: true }],
        strict: false,
      });

      const result = validator.validate({ name: 'Alice', unknownField: 'value' });
      expect(result.isValid).toBe(true);
    });
  });

  describe('transforms', () => {
    it('should apply transform functions', () => {
      const validator = new SchemaValidator({
        fields: [
          {
            name: 'name',
            type: 'string',
            required: true,
            transform: (v) => String(v).trim().toUpperCase(),
          },
        ],
      });

      const result = validator.applyTransforms({ name: '  alice  ' });
      expect(result.name).toBe('ALICE');
    });

    it('should apply default values for missing fields', () => {
      const validator = new SchemaValidator({
        fields: [
          { name: 'role', type: 'string', required: false, defaultValue: 'user' },
        ],
      });

      const result = validator.applyTransforms({});
      expect(result.role).toBe('user');
    });
  });

  describe('multiple errors', () => {
    it('should collect all errors for a single record', () => {
      const validator = new SchemaValidator({
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'age', type: 'number', required: true },
          { name: 'name', type: 'string', required: true },
        ],
      });

      const result = validator.validate({ email: 'invalid', age: 'abc' });
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
