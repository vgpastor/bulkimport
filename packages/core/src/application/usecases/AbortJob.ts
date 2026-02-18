import type { JobContext } from '../JobContext.js';

/** Use case: cancel the job permanently. Terminal state — cannot be resumed. */
export class AbortJob {
  constructor(private readonly ctx: JobContext) {}

  async execute(): Promise<void> {
    if (this.ctx.status !== 'PROCESSING' && this.ctx.status !== 'PAUSED') {
      throw new Error(`Cannot abort job from status '${this.ctx.status}'`);
    }

    this.ctx.transitionTo('ABORTED');
    this.ctx.abortController?.abort();

    if (this.ctx.pausePromise) {
      this.ctx.pausePromise.resolve();
      this.ctx.pausePromise = null;
    }

    const progress = this.ctx.buildProgress();
    this.ctx.eventBus.emit({
      type: 'job:aborted',
      jobId: this.ctx.jobId,
      progress,
      timestamp: Date.now(),
    });

    await this.ctx.saveState();
  }
}
