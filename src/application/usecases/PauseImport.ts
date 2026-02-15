import type { ImportJobContext } from '../ImportJobContext.js';

/** Use case: pause a running import after the current record completes. */
export class PauseImport {
  constructor(private readonly ctx: ImportJobContext) {}

  async execute(): Promise<void> {
    if (this.ctx.status !== 'PROCESSING') {
      throw new Error(`Cannot pause import from status '${this.ctx.status}'`);
    }

    this.ctx.transitionTo('PAUSED');
    this.ctx.pausePromise = this.ctx.createPausePromise();

    const progress = this.ctx.buildProgress();
    this.ctx.eventBus.emit({
      type: 'import:paused',
      jobId: this.ctx.jobId,
      progress,
      timestamp: Date.now(),
    });

    await this.ctx.saveState();
  }
}
