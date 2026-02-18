import type { JobContext } from '../JobContext.js';

/** Use case: resume a paused job. */
export class ResumeJob {
  constructor(private readonly ctx: JobContext) {}

  execute(): void {
    if (this.ctx.status === 'ABORTED') {
      throw new Error('Cannot resume an aborted job');
    }
    if (this.ctx.status !== 'PAUSED') {
      throw new Error(`Cannot resume job from status '${this.ctx.status}'`);
    }

    this.ctx.transitionTo('PROCESSING');
    if (this.ctx.pausePromise) {
      this.ctx.pausePromise.resolve();
      this.ctx.pausePromise = null;
    }
  }
}
