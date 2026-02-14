import type { EventType, EventPayload, DomainEvent } from '../domain/events/DomainEvents.js';

type EventHandler<T extends EventType> = (event: EventPayload<T>) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (event: any) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<AnyHandler>>();

  on<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type) ?? new Set<AnyHandler>();
    existing.add(handler as AnyHandler);
    this.handlers.set(type, existing);
  }

  off<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type);
    if (existing) {
      existing.delete(handler as AnyHandler);
    }
  }

  emit(event: DomainEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }
}
