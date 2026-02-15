import type { EventType, EventPayload, DomainEvent } from '../domain/events/DomainEvents.js';

type EventHandler<T extends EventType> = (event: EventPayload<T>) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (event: any) => void;

/** Typed event bus for domain events. Subscribe with `on()`, publish with `emit()`. */
export class EventBus {
  private readonly handlers = new Map<string, Set<AnyHandler>>();

  /** Subscribe to events of the given type. */
  on<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type) ?? new Set<AnyHandler>();
    existing.add(handler as AnyHandler);
    this.handlers.set(type, existing);
  }

  /** Unsubscribe a previously registered handler. */
  off<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type);
    if (existing) {
      existing.delete(handler as AnyHandler);
    }
  }

  /** Emit a domain event to all registered handlers. A throwing handler does not prevent others from executing. */
  emit(event: DomainEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          // Swallow handler errors so one broken subscriber cannot
          // disrupt the import pipeline or prevent other handlers from running.
        }
      }
    }
  }
}
