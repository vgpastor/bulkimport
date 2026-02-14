export const ImportStatus = {
  CREATED: 'CREATED',
  PREVIEWING: 'PREVIEWING',
  PREVIEWED: 'PREVIEWED',
  PROCESSING: 'PROCESSING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  ABORTED: 'ABORTED',
  FAILED: 'FAILED',
} as const;

export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

const VALID_TRANSITIONS: Record<ImportStatus, readonly ImportStatus[]> = {
  [ImportStatus.CREATED]: [ImportStatus.PREVIEWING, ImportStatus.PROCESSING],
  [ImportStatus.PREVIEWING]: [ImportStatus.PREVIEWED, ImportStatus.FAILED],
  [ImportStatus.PREVIEWED]: [ImportStatus.PROCESSING],
  [ImportStatus.PROCESSING]: [ImportStatus.PAUSED, ImportStatus.COMPLETED, ImportStatus.ABORTED, ImportStatus.FAILED],
  [ImportStatus.PAUSED]: [ImportStatus.PROCESSING, ImportStatus.ABORTED],
  [ImportStatus.COMPLETED]: [],
  [ImportStatus.ABORTED]: [],
  [ImportStatus.FAILED]: [],
};

export function canTransition(from: ImportStatus, to: ImportStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
