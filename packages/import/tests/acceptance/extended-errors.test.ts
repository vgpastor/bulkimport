import { describe, it, expect } from 'vitest';
import { BulkImport } from '../../src/BulkImport.js';
import { CsvParser } from '../../src/infrastructure/parsers/CsvParser.js';
import { BufferSource, hasErrors, getWarnings, getErrors } from '@batchactions/core';
import type { ParsedRecord, ValidationError } from '@batchactions/core';

// ============================================================
// Extended Errors — Severity, category, suggestion, metadata
// ============================================================
describe('Extended Errors', () => {
  it('should include category on built-in validation errors', async () => {
    const csv = ['email,name,age', ',User 1,not-a-number'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number', required: false },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);

    const errors = failedRecords[0]?.errors ?? [];
    // REQUIRED error → category: 'VALIDATION'
    const requiredError = errors.find((e) => e.code === 'REQUIRED');
    expect(requiredError).toBeDefined();
    expect(requiredError?.category).toBe('VALIDATION');

    // TYPE_MISMATCH error → category: 'FORMAT'
    const typeError = errors.find((e) => e.code === 'TYPE_MISMATCH');
    expect(typeError).toBeDefined();
    expect(typeError?.category).toBe('FORMAT');
  });

  it('should propagate severity and suggestion from customValidator', async () => {
    const csv = ['value', 'test-value'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          {
            name: 'value',
            type: 'custom',
            required: true,
            customValidator: (_v) => ({
              valid: false,
              message: 'Value is deprecated',
              severity: 'warning' as const,
              suggestion: 'Use "new-value" instead',
              metadata: { deprecatedSince: '2024-01-01' },
            }),
          },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Warning-severity errors are non-blocking — record should be processed
    expect(processed).toHaveLength(1);
    expect(importer.getStatus().progress.processedRecords).toBe(1);
    expect(importer.getStatus().progress.failedRecords).toBe(0);
  });

  it('should treat warnings as non-blocking (record goes to processor)', async () => {
    const csv = ['score,name', '50,Alice', '90,Bob'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          {
            name: 'score',
            type: 'number',
            required: true,
            customValidator: (v) => {
              const num = Number(v);
              if (num < 60) {
                return {
                  valid: false,
                  message: 'Score is below threshold',
                  severity: 'warning' as const,
                  suggestion: 'Scores below 60 may be reviewed manually',
                };
              }
              return { valid: true };
            },
          },
          { name: 'name', type: 'string', required: true },
        ],
      },
      batchSize: 10,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Both records should be processed (warning is non-blocking)
    expect(processed).toHaveLength(2);
    expect(importer.getStatus().status).toBe('COMPLETED');
    expect(importer.getStatus().progress.processedRecords).toBe(2);
    expect(importer.getStatus().progress.failedRecords).toBe(0);
  });

  it('should include warnings in processed record errors array', async () => {
    const csv = ['value', 'test'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          {
            name: 'value',
            type: 'custom',
            required: true,
            customValidator: () => ({
              valid: false,
              message: 'Heads up: value may need review',
              severity: 'warning' as const,
            }),
          },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processedRecords: ParsedRecord[] = [];
    importer.on('record:processed', () => {
      // record processed successfully despite warning
    });

    await importer.start(async (record) => {
      processedRecords.push(record);
      await Promise.resolve();
    });

    expect(processedRecords).toHaveLength(1);
    expect(importer.getStatus().progress.processedRecords).toBe(1);
  });

  it('should filter with hasErrors, getWarnings, and getErrors helpers', () => {
    const errors: ValidationError[] = [
      { field: 'email', message: 'Invalid email', code: 'TYPE_MISMATCH', severity: 'error', category: 'FORMAT' },
      { field: 'name', message: 'Name too short', code: 'CUSTOM_VALIDATION', severity: 'warning', category: 'CUSTOM' },
      { field: 'age', message: 'Age required', code: 'REQUIRED', category: 'VALIDATION' }, // no severity = error
    ];

    expect(hasErrors(errors)).toBe(true);
    expect(getErrors(errors)).toHaveLength(2); // email + age
    expect(getWarnings(errors)).toHaveLength(1); // name

    const warningsOnly: ValidationError[] = [
      {
        field: 'x',
        message: 'just a warning',
        code: 'CUSTOM_VALIDATION',
        severity: 'warning',
        category: 'CUSTOM',
      },
    ];
    expect(hasErrors(warningsOnly)).toBe(false);
    expect(getErrors(warningsOnly)).toHaveLength(0);
    expect(getWarnings(warningsOnly)).toHaveLength(1);
  });

  it('should set category DUPLICATE on DUPLICATE_VALUE errors', async () => {
    const csv = ['email,name', 'user@test.com,Alice', 'user@test.com,Bob'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
        uniqueFields: ['email'],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    const dupError = failedRecords[0]?.errors.find((e) => e.code === 'DUPLICATE_VALUE');
    expect(dupError).toBeDefined();
    expect(dupError?.category).toBe('DUPLICATE');
  });

  it('should set category VALIDATION on UNKNOWN_FIELD errors in strict mode', async () => {
    const csv = ['email,name,extraField', 'user@test.com,Alice,extra'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'name', type: 'string', required: true },
        ],
        strict: true,
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    const unknownError = failedRecords[0]?.errors.find((e) => e.code === 'UNKNOWN_FIELD');
    expect(unknownError).toBeDefined();
    expect(unknownError?.category).toBe('VALIDATION');
  });

  it('should set category FORMAT on PATTERN_MISMATCH errors', async () => {
    const csv = ['code,name', 'invalid,Alice'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          { name: 'code', type: 'string', required: true, pattern: /^[A-Z]{3}-\d{3}$/ },
          { name: 'name', type: 'string', required: true },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    const patternError = failedRecords[0]?.errors.find((e) => e.code === 'PATTERN_MISMATCH');
    expect(patternError).toBeDefined();
    expect(patternError?.category).toBe('FORMAT');
  });

  it('should set category CUSTOM on CUSTOM_VALIDATION errors', async () => {
    const csv = ['value', 'bad'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          {
            name: 'value',
            type: 'custom',
            required: true,
            customValidator: () => ({
              valid: false,
              message: 'Custom check failed',
            }),
          },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    await importer.start(async () => {
      await Promise.resolve();
    });

    const failedRecords = await importer.getFailedRecords();
    expect(failedRecords).toHaveLength(1);
    const customError = failedRecords[0]?.errors.find((e) => e.code === 'CUSTOM_VALIDATION');
    expect(customError).toBeDefined();
    expect(customError?.category).toBe('CUSTOM');
  });

  it('should propagate metadata from customValidator', async () => {
    const csv = ['value', 'old-format'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          {
            name: 'value',
            type: 'custom',
            required: true,
            customValidator: () => ({
              valid: false,
              message: 'Deprecated format',
              severity: 'warning' as const,
              metadata: { allowedFormats: ['new-format-a', 'new-format-b'] },
            }),
          },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Warning — record passes through
    expect(processed).toHaveLength(1);
  });

  it('should block record with mix of warning and error', async () => {
    const csv = ['score,email', '50,not-an-email'].join('\n');

    const importer = new BulkImport({
      schema: {
        fields: [
          {
            name: 'score',
            type: 'number',
            required: true,
            customValidator: (v) => {
              const num = Number(v);
              if (num < 60) {
                return { valid: false, message: 'Low score', severity: 'warning' as const };
              }
              return { valid: true };
            },
          },
          { name: 'email', type: 'email', required: true },
        ],
      },
      batchSize: 10,
      continueOnError: true,
    });
    importer.from(new BufferSource(csv), new CsvParser());

    const processed: ParsedRecord[] = [];
    await importer.start(async (record) => {
      processed.push(record);
      await Promise.resolve();
    });

    // Email error (hard) should block, even though score is only a warning
    expect(processed).toHaveLength(0);
    expect(importer.getStatus().progress.failedRecords).toBe(1);
  });
});
