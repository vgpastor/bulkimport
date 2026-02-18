import type { ProcessingContext } from '@batchactions/core';

/** Result of checking a record for external duplicates. */
export interface DuplicateCheckResult {
  /** Whether the record is a duplicate of an existing entry. */
  readonly isDuplicate: boolean;
  /** Identifier of the existing duplicate entry (e.g. database primary key). */
  readonly existingId?: string;
  /** Additional metadata about the duplicate match. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Port for checking records against external data sources for duplicates.
 *
 * Implement this interface to check duplicates against a database, API, or
 * any other external source. The built-in `uniqueFields` schema option handles
 * in-memory cross-record uniqueness within the import; this port is for
 * checking against data that already exists outside the current import.
 *
 * @example
 * ```typescript
 * const checker: DuplicateChecker = {
 *   async check(fields, context) {
 *     const existing = await db.query('SELECT id FROM users WHERE email = $1', [fields.email]);
 *     return { isDuplicate: existing.length > 0, existingId: existing[0]?.id };
 *   },
 * };
 * ```
 */
export interface DuplicateChecker {
  /** Check a single record's fields for duplicates against external data. */
  check(fields: Record<string, unknown>, context: ProcessingContext): Promise<DuplicateCheckResult>;

  /**
   * Optional batch-optimized check. When provided, called once per batch with
   * all valid records instead of calling `check()` individually. Results must
   * be returned in the same order as the input records.
   */
  checkBatch?(
    records: readonly { fields: Record<string, unknown>; context: ProcessingContext }[],
  ): Promise<readonly DuplicateCheckResult[]>;
}
