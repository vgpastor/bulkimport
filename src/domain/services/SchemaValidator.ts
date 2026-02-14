import type { SchemaDefinition } from '../model/Schema.js';
import type { RawRecord } from '../model/Record.js';
import type { ValidationResult, ValidationError } from '../model/ValidationResult.js';
import type { FieldDefinition } from '../model/FieldDefinition.js';
import { validResult, invalidResult } from '../model/ValidationResult.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SchemaValidator {
  constructor(private readonly schema: SchemaDefinition) {}

  validate(record: RawRecord): ValidationResult {
    const errors: ValidationError[] = [];

    for (const field of this.schema.fields) {
      const value = record[field.name];
      const fieldErrors = this.validateField(field, value);
      errors.push(...fieldErrors);
    }

    if (this.schema.strict) {
      const definedFields = new Set(this.schema.fields.map((f) => f.name));
      for (const key of Object.keys(record)) {
        if (!definedFields.has(key)) {
          errors.push({
            field: key,
            message: `Unknown field '${key}' is not allowed in strict mode`,
            code: 'UNKNOWN_FIELD',
            value: record[key],
          });
        }
      }
    }

    return errors.length === 0 ? validResult() : invalidResult(errors);
  }

  applyTransforms(record: RawRecord): RawRecord {
    const transformed: Record<string, unknown> = { ...record };

    for (const field of this.schema.fields) {
      if (field.transform && transformed[field.name] !== undefined) {
        transformed[field.name] = field.transform(transformed[field.name]);
      }
      if (transformed[field.name] === undefined && field.defaultValue !== undefined) {
        transformed[field.name] = field.defaultValue;
      }
    }

    return transformed as RawRecord;
  }

  private validateField(field: FieldDefinition, value: unknown): ValidationError[] {
    const errors: ValidationError[] = [];

    if (this.isEmpty(value)) {
      if (field.required) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' is required`,
          code: 'REQUIRED',
          value,
        });
      }
      return errors;
    }

    if (field.type !== 'custom') {
      const typeError = this.validateType(field, value);
      if (typeError) {
        errors.push(typeError);
        return errors;
      }
    }

    if (field.pattern) {
      const stringValue = String(value);
      if (!field.pattern.test(stringValue)) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' does not match pattern ${String(field.pattern)}`,
          code: 'PATTERN_MISMATCH',
          value,
        });
      }
    }

    if (field.customValidator) {
      const result = field.customValidator(value);
      if (!result.valid) {
        errors.push({
          field: field.name,
          message: result.message ?? `Custom validation failed for field '${field.name}'`,
          code: 'CUSTOM_VALIDATION',
          value,
        });
      }
    }

    return errors;
  }

  private validateType(field: FieldDefinition, value: unknown): ValidationError | null {
    const stringValue = String(value);

    switch (field.type) {
      case 'number': {
        const num = Number(stringValue);
        if (isNaN(num)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a number`,
            code: 'TYPE_MISMATCH',
            value,
          };
        }
        return null;
      }
      case 'boolean': {
        const lower = stringValue.toLowerCase();
        if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lower)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a boolean`,
            code: 'TYPE_MISMATCH',
            value,
          };
        }
        return null;
      }
      case 'date': {
        const date = new Date(stringValue);
        if (isNaN(date.getTime())) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a valid date`,
            code: 'TYPE_MISMATCH',
            value,
          };
        }
        return null;
      }
      case 'email': {
        if (!EMAIL_PATTERN.test(stringValue)) {
          return {
            field: field.name,
            message: `Field '${field.name}' must be a valid email`,
            code: 'TYPE_MISMATCH',
            value,
          };
        }
        return null;
      }
      case 'string':
        return null;
      default:
        return null;
    }
  }

  private isEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === '';
  }
}
