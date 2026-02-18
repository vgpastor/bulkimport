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
        fields: [{ name: 'role', type: 'string', required: false, defaultValue: 'user' }],
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

  describe('isEmptyRow', () => {
    const validator = new SchemaValidator({
      fields: [{ name: 'name', type: 'string', required: true }],
    });

    it('should detect row with all empty strings as empty', () => {
      expect(validator.isEmptyRow({ name: '', age: '' })).toBe(true);
    });

    it('should detect row with all null/undefined as empty', () => {
      expect(validator.isEmptyRow({ name: null, age: undefined })).toBe(true);
    });

    it('should detect row with mixed empty values as empty', () => {
      expect(validator.isEmptyRow({ name: '', age: null, role: undefined })).toBe(true);
    });

    it('should not detect row with at least one value as empty', () => {
      expect(validator.isEmptyRow({ name: 'Alice', age: '' })).toBe(false);
    });

    it('should detect empty object as empty', () => {
      expect(validator.isEmptyRow({})).toBe(true);
    });
  });

  describe('skipEmptyRows flag', () => {
    it('should expose skipEmptyRows as false by default', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'name', type: 'string', required: true }],
      });
      expect(validator.skipEmptyRows).toBe(false);
    });

    it('should expose skipEmptyRows as true when configured', () => {
      const validator = new SchemaValidator({
        fields: [{ name: 'name', type: 'string', required: true }],
        skipEmptyRows: true,
      });
      expect(validator.skipEmptyRows).toBe(true);
    });
  });

  describe('array field type', () => {
    const validator = new SchemaValidator({
      fields: [{ name: 'tags', type: 'array', required: false }],
    });

    it('should accept string value for array field', () => {
      const result = validator.validate({ tags: 'a,b,c' });
      expect(result.isValid).toBe(true);
    });

    it('should accept array value for array field', () => {
      const result = validator.validate({ tags: ['a', 'b'] });
      expect(result.isValid).toBe(true);
    });

    it('should reject non-string non-array value', () => {
      const result = validator.validate({ tags: 123 });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]?.code).toBe('TYPE_MISMATCH');
    });

    it('should split string into array during applyTransforms', () => {
      const result = validator.applyTransforms({ tags: 'a, b, c' });
      expect(result.tags).toEqual(['a', 'b', 'c']);
    });

    it('should use custom separator', () => {
      const v = new SchemaValidator({
        fields: [{ name: 'tags', type: 'array', required: false, separator: ';' }],
      });
      const result = v.applyTransforms({ tags: 'a;b;c' });
      expect(result.tags).toEqual(['a', 'b', 'c']);
    });

    it('should filter empty items after split', () => {
      const result = validator.applyTransforms({ tags: 'a,,b,,c,' });
      expect(result.tags).toEqual(['a', 'b', 'c']);
    });

    it('should not transform if value is already an array', () => {
      const result = validator.applyTransforms({ tags: ['x', 'y'] });
      expect(result.tags).toEqual(['x', 'y']);
    });
  });

  describe('resolveAliases', () => {
    const validator = new SchemaValidator({
      fields: [
        { name: 'email', type: 'email', required: true, aliases: ['correo', 'mail'] },
        { name: 'name', type: 'string', required: true, aliases: ['nombre'] },
      ],
    });

    it('should resolve alias to canonical name', () => {
      const result = validator.resolveAliases({ correo: 'a@b.com', nombre: 'Alice' });
      expect(result).toEqual({ email: 'a@b.com', name: 'Alice' });
    });

    it('should be case-insensitive', () => {
      const result = validator.resolveAliases({ CORREO: 'a@b.com', NOMBRE: 'Alice' });
      expect(result).toEqual({ email: 'a@b.com', name: 'Alice' });
    });

    it('should keep canonical name if already present', () => {
      const result = validator.resolveAliases({ email: 'a@b.com', name: 'Alice' });
      expect(result).toEqual({ email: 'a@b.com', name: 'Alice' });
    });

    it('should pass through unknown fields', () => {
      const result = validator.resolveAliases({ email: 'a@b.com', name: 'Alice', extra: 'value' });
      expect(result.extra).toBe('value');
    });

    it('should report hasAliases correctly', () => {
      expect(validator.hasAliases).toBe(true);

      const noAliases = new SchemaValidator({
        fields: [{ name: 'email', type: 'email', required: true }],
      });
      expect(noAliases.hasAliases).toBe(false);
    });
  });

  describe('validateUniqueness', () => {
    const validator = new SchemaValidator({
      fields: [
        { name: 'identifier', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
      ],
      uniqueFields: ['identifier'],
    });

    it('should pass for first occurrence', () => {
      const seen = new Map<string, Set<unknown>>();
      const errors = validator.validateUniqueness({ identifier: 'ID001', name: 'Alice' }, seen);
      expect(errors).toHaveLength(0);
    });

    it('should fail for duplicate occurrence', () => {
      const seen = new Map<string, Set<unknown>>();
      validator.validateUniqueness({ identifier: 'ID001', name: 'Alice' }, seen);
      const errors = validator.validateUniqueness({ identifier: 'ID001', name: 'Bob' }, seen);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe('DUPLICATE_VALUE');
    });

    it('should be case-insensitive for strings', () => {
      const seen = new Map<string, Set<unknown>>();
      validator.validateUniqueness({ identifier: 'abc', name: 'Alice' }, seen);
      const errors = validator.validateUniqueness({ identifier: 'ABC', name: 'Bob' }, seen);
      expect(errors).toHaveLength(1);
    });

    it('should skip empty values', () => {
      const seen = new Map<string, Set<unknown>>();
      const errors1 = validator.validateUniqueness({ identifier: '', name: 'Alice' }, seen);
      const errors2 = validator.validateUniqueness({ identifier: '', name: 'Bob' }, seen);
      expect(errors1).toHaveLength(0);
      expect(errors2).toHaveLength(0);
    });

    it('should report hasUniqueFields correctly', () => {
      expect(validator.hasUniqueFields).toBe(true);

      const noUnique = new SchemaValidator({
        fields: [{ name: 'name', type: 'string', required: true }],
      });
      expect(noUnique.hasUniqueFields).toBe(false);
    });
  });
});
