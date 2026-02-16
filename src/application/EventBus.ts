import type { EventType, EventPayload, DomainEvent } from '../domain/events/DomainEvents.js';

type EventHandler<T extends EventType> = (event: EventPayload<T>) => void;

type WildcardHandler = (event: DomainEvent) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (event: any) => void;

/** Typed event bus for domain events. Subscribe with `on()`, publish with `emit()`. */
export class EventBus {
  private readonly handlers = new Map<string, Set<AnyHandler>>();
  private readonly wildcardHandlers = new Set<WildcardHandler>();

  /** Subscribe to events of the given type. */
  on<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type) ?? new Set<AnyHandler>();
    existing.add(handler as AnyHandler);
    this.handlers.set(type, existing);
  }

  /** Subscribe to all events regardless of type. */
  onAny(handler: WildcardHandler): void {
    this.wildcardHandlers.add(handler);
  }

  /** Unsubscribe a previously registered handler. */
  off<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type);
    if (existing) {
      existing.delete(handler as AnyHandler);
    }
  }

  /** Unsubscribe a wildcard handler. */
  offAny(handler: WildcardHandler): void {
    this.wildcardHandlers.delete(handler);
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

    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch {
        // Swallow handler errors.
      }
    }
  }
}
