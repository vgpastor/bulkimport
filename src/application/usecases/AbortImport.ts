import type { ImportJobContext } from '../ImportJobContext.js';

/** Use case: cancel the import permanently. Terminal state — cannot be resumed. */
export class AbortImport {
  constructor(private readonly ctx: ImportJobContext) {}

  async execute(): Promise<void> {
    if (this.ctx.status !== 'PROCESSING' && this.ctx.status !== 'PAUSED') {
      throw new Error(`Cannot abort import from status '${this.ctx.status}'`);
    }

    this.ctx.transitionTo('ABORTED');
    this.ctx.abortController?.abort();

    if (this.ctx.pausePromise) {
      this.ctx.pausePromise.resolve();
      this.ctx.pausePromise = null;
    }

    const progress = this.ctx.buildProgress();
    this.ctx.eventBus.emit({
      type: 'import:aborted',
      jobId: this.ctx.jobId,
      progress,
      timestamp: Date.now(),
    });

    await this.ctx.saveState();
  }
}
