import type { SchemaDefinition } from '../model/Schema.js';
import type { RawRecord } from '../model/Record.js';
import { isEmptyRow as isEmptyRowCheck } from '../model/Record.js';
import type { ValidationResult, ValidationError } from '../model/ValidationResult.js';
import type { FieldDefinition } from '../model/FieldDefinition.js';
import { validResult, invalidResult } from '../model/ValidationResult.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Domain service that validates records against a schema definition.
 *
 * Handles type checking, required fields, patterns, custom validators,
 * alias resolution, array splitting, transforms, defaults, and uniqueness.
 */
export class SchemaValidator {
  private readonly aliasMap: ReadonlyMap<string, string>;

  constructor(private readonly schema: SchemaDefinition) {
    this.aliasMap = this.buildAliasMap();
  }

  /** Validate a record against all field definitions. Returns errors for each failing field. */
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

  /** Check unique field constraints against a shared set of seen values. Cross-batch, case-insensitive for strings. */
  validateUniqueness(record: RawRecord, seenValues: Map<string, Set<unknown>>): ValidationError[] {
    const errors: ValidationError[] = [];
    const uniqueFields = this.schema.uniqueFields;

    if (!uniqueFields || uniqueFields.length === 0) return errors;

    for (const fieldName of uniqueFields) {
      const value = record[fieldName];
      if (this.isEmpty(value)) continue;

      let seen = seenValues.get(fieldName);
      if (!seen) {
        seen = new Set<unknown>();
        seenValues.set(fieldName, seen);
      }

      const key = typeof value === 'string' ? value.toLowerCase() : value;

      if (seen.has(key)) {
        errors.push({
          field: fieldName,
          message: `Duplicate value '${String(value)}' for unique field '${fieldName}'`,
          code: 'DUPLICATE_VALUE',
          value,
        });
      } else {
        seen.add(key);
      }
    }

    return errors;
  }

  /** Map aliased or differently-cased column names to their canonical field names. */
  resolveAliases(record: RawRecord): RawRecord {
    if (this.aliasMap.size === 0) return record;

    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      const canonicalName = this.aliasMap.get(key.toLowerCase());
      if (canonicalName && !(canonicalName in resolved)) {
        resolved[canonicalName] = value;
      } else if (!canonicalName) {
        resolved[key] = value;
      }
    }

    return resolved as RawRecord;
  }

  /** Apply array splitting, custom transforms, and default values to a record. */
  applyTransforms(record: RawRecord): RawRecord {
    const transformed: Record<string, unknown> = { ...record };

    for (const field of this.schema.fields) {
      if (field.type === 'array' && transformed[field.name] !== undefined) {
        const raw = transformed[field.name];
        const separator = field.separator ?? ',';
        if (typeof raw === 'string') {
          let items = raw
            .split(separator)
            .map((s) => s.trim())
            .filter((s) => s !== '');
          if (field.itemTransform) {
            items = items.map(field.itemTransform);
          }
          transformed[field.name] = items;
        }
      }

      if (field.transform && transformed[field.name] !== undefined) {
        transformed[field.name] = field.transform(transformed[field.name]);
      }
      if (transformed[field.name] === undefined && field.defaultValue !== undefined) {
        transformed[field.name] = field.defaultValue;
      }
    }

    return transformed as RawRecord;
  }

  /** Check whether every value in the record is empty (`undefined`, `null`, or `''`). */
  isEmptyRow(record: RawRecord): boolean {
    return isEmptyRowCheck(record);
  }

  /** Whether the schema is configured to skip rows where all values are empty. */
  get skipEmptyRows(): boolean {
    return this.schema.skipEmptyRows ?? false;
  }

  /** Whether any field defines explicit aliases (beyond canonical name resolution). */
  get hasAliases(): boolean {
    return this.aliasMap.size > this.schema.fields.length;
  }

  /** Whether the schema declares any unique field constraints. */
  get hasUniqueFields(): boolean {
    return (this.schema.uniqueFields ?? []).length > 0;
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

    if (field.type === 'array') {
      const arrayError = this.validateArrayType(field, value);
      if (arrayError) {
        errors.push(arrayError);
        return errors;
      }
    } else if (field.type !== 'custom') {
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

  private validateArrayType(field: FieldDefinition, value: unknown): ValidationError | null {
    if (Array.isArray(value) || typeof value === 'string') return null;

    return {
      field: field.name,
      message: `Field '${field.name}' must be a string (to be split) or an array`,
      code: 'TYPE_MISMATCH',
      value,
    };
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

  private buildAliasMap(): Map<string, string> {
    const map = new Map<string, string>();

    for (const field of this.schema.fields) {
      map.set(field.name.toLowerCase(), field.name);

      if (field.aliases) {
        for (const alias of field.aliases) {
          map.set(alias.toLowerCase(), field.name);
        }
      }
    }

    return map;
  }

  private isEmpty(value: unknown): boolean {
    if (value === undefined || value === null || value === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }
}
