import { describe, it, expect } from 'vitest';
import { canTransition } from '../../../src/domain/model/ImportStatus.js';

describe('ImportStatus state machine', () => {
  it('should allow CREATED → PREVIEWING', () => {
    expect(canTransition('CREATED', 'PREVIEWING')).toBe(true);
  });

  it('should allow CREATED → PROCESSING (skip preview)', () => {
    expect(canTransition('CREATED', 'PROCESSING')).toBe(true);
  });

  it('should allow PREVIEWING → PREVIEWED', () => {
    expect(canTransition('PREVIEWING', 'PREVIEWED')).toBe(true);
  });

  it('should allow PREVIEWED → PROCESSING', () => {
    expect(canTransition('PREVIEWED', 'PROCESSING')).toBe(true);
  });

  it('should allow PROCESSING → PAUSED', () => {
    expect(canTransition('PROCESSING', 'PAUSED')).toBe(true);
  });

  it('should allow PROCESSING → COMPLETED', () => {
    expect(canTransition('PROCESSING', 'COMPLETED')).toBe(true);
  });

  it('should allow PROCESSING → ABORTED', () => {
    expect(canTransition('PROCESSING', 'ABORTED')).toBe(true);
  });

  it('should allow PAUSED → PROCESSING (resume)', () => {
    expect(canTransition('PAUSED', 'PROCESSING')).toBe(true);
  });

  it('should allow PAUSED → ABORTED', () => {
    expect(canTransition('PAUSED', 'ABORTED')).toBe(true);
  });

  it('should NOT allow COMPLETED → anything', () => {
    expect(canTransition('COMPLETED', 'PROCESSING')).toBe(false);
    expect(canTransition('COMPLETED', 'PAUSED')).toBe(false);
  });

  it('should NOT allow ABORTED → anything', () => {
    expect(canTransition('ABORTED', 'PROCESSING')).toBe(false);
    expect(canTransition('ABORTED', 'PAUSED')).toBe(false);
  });

  it('should NOT allow CREATED → COMPLETED directly', () => {
    expect(canTransition('CREATED', 'COMPLETED')).toBe(false);
  });
});
