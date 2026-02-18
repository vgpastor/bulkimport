import type { JobContext } from '../JobContext.js';

/** Use case: pause a running job after the current record completes. */
export class PauseJob {
  constructor(private readonly ctx: JobContext) {}

  async execute(): Promise<void> {
    if (this.ctx.status !== 'PROCESSING') {
      throw new Error(`Cannot pause job from status '${this.ctx.status}'`);
    }

    this.ctx.transitionTo('PAUSED');
    this.ctx.pausePromise = this.ctx.createPausePromise();

    const progress = this.ctx.buildProgress();
    this.ctx.eventBus.emit({
      type: 'job:paused',
      jobId: this.ctx.jobId,
      progress,
      timestamp: Date.now(),
    });

    await this.ctx.saveState();
  }
}
