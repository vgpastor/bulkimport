import type { ImportJobContext } from '../ImportJobContext.js';

/** Use case: resume a paused import. */
export class ResumeImport {
  constructor(private readonly ctx: ImportJobContext) {}

  execute(): void {
    if (this.ctx.status === 'ABORTED') {
      throw new Error('Cannot resume an aborted import');
    }
    if (this.ctx.status !== 'PAUSED') {
      throw new Error(`Cannot resume import from status '${this.ctx.status}'`);
    }

    this.ctx.transitionTo('PROCESSING');
    if (this.ctx.pausePromise) {
      this.ctx.pausePromise.resolve();
      this.ctx.pausePromise = null;
    }
  }
}
