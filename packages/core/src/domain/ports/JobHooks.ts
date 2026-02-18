import type { RawRecord, ProcessedRecord, ParsedRecord } from '../model/Record.js';

/** Context passed to lifecycle hook functions. */
export interface HookContext {
  /** Unique job identifier. */
  readonly jobId: string;
  /** Unique batch identifier. */
  readonly batchId: string;
  /** Zero-based batch index. */
  readonly batchIndex: number;
  /** Zero-based record index within the entire job. */
  readonly recordIndex: number;
  /** Total records parsed so far (may grow during streaming). */
  readonly totalRecords: number;
  /** Abort signal for cancellation detection. */
  readonly signal: AbortSignal;
}

/**
 * Lifecycle hooks for intercepting the record processing pipeline.
 *
 * All hooks are optional. If a hook throws, the record is marked as failed
 * (same behavior as a failing processor callback).
 *
 * Pipeline order (when `validate` is configured):
 * 1. Parse raw record from source
 * 2. **`beforeValidate`** — modify raw data before validation (e.g. data enrichment)
 * 3. `validate(record)` — optional validation function
 * 4. **`afterValidate`** — inspect/modify the processed record after validation
 * 5. **`beforeProcess`** — modify parsed data before the processor callback
 * 6. Processor callback
 * 7. **`afterProcess`** — trigger side effects after successful processing
 *
 * When `validate` is not configured, hooks `beforeValidate` and `afterValidate` are skipped.
 */
export interface JobHooks {
  /** Called before the validate function. Can modify the raw record. Only invoked when `validate` is configured. */
  beforeValidate?: (record: RawRecord, context: HookContext) => Promise<RawRecord>;
  /** Called after validation. Can inspect or modify the processed record (e.g. downgrade errors). Only invoked when `validate` is configured. */
  afterValidate?: (record: ProcessedRecord, context: HookContext) => Promise<ProcessedRecord>;
  /** Called before the processor callback. Can modify the parsed data. */
  beforeProcess?: (record: ParsedRecord, context: HookContext) => Promise<ParsedRecord>;
  /** Called after the processor callback succeeds. For side effects (e.g. audit logging, related entities). */
  afterProcess?: (record: ProcessedRecord, context: HookContext) => Promise<void>;
}
