import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../../src/application/EventBus.js';
import type { ImportStartedEvent, BatchCompletedEvent } from '../../../src/domain/events/DomainEvents.js';

describe('EventBus', () => {
  it('should emit events to registered handlers', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('import:started', handler);

    const event: ImportStartedEvent = {
      type: 'import:started',
      jobId: 'test-job',
      totalRecords: 100,
      totalBatches: 10,
      timestamp: Date.now(),
    };

    bus.emit(event);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should not call handlers for different event types', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('import:started', handler);

    const event: BatchCompletedEvent = {
      type: 'batch:completed',
      jobId: 'test-job',
      batchId: 'batch-1',
      batchIndex: 0,
      processedCount: 10,
      failedCount: 0,
      totalCount: 10,
      timestamp: Date.now(),
    };

    bus.emit(event);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple handlers for the same event', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('import:started', handler1);
    bus.on('import:started', handler2);

    const event: ImportStartedEvent = {
      type: 'import:started',
      jobId: 'test-job',
      totalRecords: 100,
      totalBatches: 10,
      timestamp: Date.now(),
    };

    bus.emit(event);
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('should remove handlers with off()', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('import:started', handler);
    bus.off('import:started', handler);

    bus.emit({
      type: 'import:started',
      jobId: 'test-job',
      totalRecords: 100,
      totalBatches: 10,
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not propagate errors from throwing handlers', () => {
    const bus = new EventBus();

    bus.on('import:started', () => {
      throw new Error('handler exploded');
    });

    expect(() => {
      bus.emit({
        type: 'import:started',
        jobId: 'test-job',
        totalRecords: 100,
        totalBatches: 10,
        timestamp: Date.now(),
      });
    }).not.toThrow();
  });

  it('should continue calling other handlers when one throws', () => {
    const bus = new EventBus();
    const handler1 = vi.fn(() => {
      throw new Error('first handler fails');
    });
    const handler2 = vi.fn();

    bus.on('import:started', handler1);
    bus.on('import:started', handler2);

    bus.emit({
      type: 'import:started',
      jobId: 'test-job',
      totalRecords: 100,
      totalBatches: 10,
      timestamp: Date.now(),
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('should do nothing when emitting event with no handlers', () => {
    const bus = new EventBus();

    expect(() => {
      bus.emit({
        type: 'import:started',
        jobId: 'test-job',
        totalRecords: 0,
        totalBatches: 0,
        timestamp: Date.now(),
      });
    }).not.toThrow();
  });

  it('should call onAny handlers for every event type', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.onAny(handler);

    const startEvent: ImportStartedEvent = {
      type: 'import:started',
      jobId: 'test-job',
      totalRecords: 0,
      totalBatches: 0,
      timestamp: Date.now(),
    };

    const batchEvent: BatchCompletedEvent = {
      type: 'batch:completed',
      jobId: 'test-job',
      batchId: 'batch-1',
      batchIndex: 0,
      processedCount: 10,
      failedCount: 0,
      totalCount: 10,
      timestamp: Date.now(),
    };

    bus.emit(startEvent);
    bus.emit(batchEvent);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(startEvent);
    expect(handler).toHaveBeenCalledWith(batchEvent);
  });

  it('should remove onAny handlers with offAny()', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.onAny(handler);
    bus.offAny(handler);

    bus.emit({
      type: 'import:started',
      jobId: 'test-job',
      totalRecords: 0,
      totalBatches: 0,
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not propagate errors from throwing onAny handlers', () => {
    const bus = new EventBus();
    const good = vi.fn();

    bus.onAny(() => {
      throw new Error('wildcard exploded');
    });
    bus.onAny(good);

    expect(() => {
      bus.emit({
        type: 'import:started',
        jobId: 'test-job',
        totalRecords: 0,
        totalBatches: 0,
        timestamp: Date.now(),
      });
    }).not.toThrow();

    expect(good).toHaveBeenCalledOnce();
  });

  it('should call both typed and wildcard handlers', () => {
    const bus = new EventBus();
    const typed = vi.fn();
    const wildcard = vi.fn();

    bus.on('import:started', typed);
    bus.onAny(wildcard);

    bus.emit({
      type: 'import:started',
      jobId: 'test-job',
      totalRecords: 0,
      totalBatches: 0,
      timestamp: Date.now(),
    });

    expect(typed).toHaveBeenCalledOnce();
    expect(wildcard).toHaveBeenCalledOnce();
  });
});
