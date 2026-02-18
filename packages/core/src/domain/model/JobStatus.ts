/**
 * Finite state machine for job lifecycle.
 *
 * Valid transitions:
 * - `CREATED` → `PREVIEWING` | `PROCESSING`
 * - `PREVIEWING` → `PREVIEWED` | `FAILED`
 * - `PREVIEWED` → `PROCESSING`
 * - `PROCESSING` → `PAUSED` | `COMPLETED` | `ABORTED` | `FAILED`
 * - `PAUSED` → `PROCESSING` | `ABORTED`
 * - `COMPLETED`, `ABORTED`, `FAILED` → (terminal)
 */
export const JobStatus = {
  CREATED: 'CREATED',
  PREVIEWING: 'PREVIEWING',
  PREVIEWED: 'PREVIEWED',
  PROCESSING: 'PROCESSING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  ABORTED: 'ABORTED',
  FAILED: 'FAILED',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

const VALID_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  [JobStatus.CREATED]: [JobStatus.PREVIEWING, JobStatus.PROCESSING],
  [JobStatus.PREVIEWING]: [JobStatus.PREVIEWED, JobStatus.FAILED],
  [JobStatus.PREVIEWED]: [JobStatus.PROCESSING],
  [JobStatus.PROCESSING]: [JobStatus.PAUSED, JobStatus.COMPLETED, JobStatus.ABORTED, JobStatus.FAILED],
  [JobStatus.PAUSED]: [JobStatus.PROCESSING, JobStatus.ABORTED],
  [JobStatus.COMPLETED]: [],
  [JobStatus.ABORTED]: [],
  [JobStatus.FAILED]: [],
};

/** Check whether a state transition is valid according to the job lifecycle FSM. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
