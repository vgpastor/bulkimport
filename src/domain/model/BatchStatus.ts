export const BatchStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type BatchStatus = (typeof BatchStatus)[keyof typeof BatchStatus];
