// Main facade
export { DistributedImport } from './DistributedImport.js';
export type { DistributedImportConfig } from './DistributedImport.js';

// Use case result types
export type { PrepareResult } from './PrepareDistributedImport.js';
export type { DistributedBatchResult, DistributedBatchConfig } from './ProcessDistributedBatch.js';

// Re-export core distributed types for convenience
export type {
  DistributedStateStore,
  BatchReservation,
  ClaimBatchResult,
  ClaimBatchFailureReason,
  DistributedJobStatus,
} from '@batchactions/core';
export { isDistributedStateStore } from '@batchactions/core';
