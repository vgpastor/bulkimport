# todo.md — @bulkimport/core

Backlog de tareas pendientes. Las fases completadas se han eliminado para mantener el fichero limpio.

Fases completadas: 1 (Foundation), 2 (Happy Path), 3 (Validación), 4 (Control de flujo), 5 (Error handling), 6 (Persistencia de estado), 7 (Preview), 8 (Fuentes de datos), 9 (Eventos), 10 (Schema avanzado), 12 (Hardening), 13 (Publicación), 14 (Performance & Memory), 15 (Code Quality & Deduplication).

---

## Ideas de usuarios (bajo evaluación)

- [ ] **Modo upsert** — config de import mode: `'insert' | 'upsert' | 'update-only'` con `matchBy: ['identifier']`. Requiere decidir si es responsabilidad del domain model o solo un pass-through en el context del processor.
- [x] **SequelizeStateStore** — implementado como subpaquete `@bulkimport/state-sequelize` en `packages/state-sequelize/`. Compatible con Sequelize v6.
- [ ] **Adaptadores de StateStore adicionales** — PrismaStateStore, RedisStateStore. Evaluar si deben vivir en paquetes separados.
- [x] **Evento `import:started` asíncrono** — emitido en el siguiente microtask para que handlers registrados después de `start()` en el mismo tick lo reciban.
- [x] **`generateTemplate()` con filas de ejemplo** — opción `exampleRows` genera datos sintéticos según el tipo de campo (email, date, number, etc.).
- [x] **`onAny()` wildcard para eventos** — suscripción a todos los eventos sin listarlos uno por uno. Ideal para relay/proxy (SSE, WebSocket).
- [x] **`ParsedRecord` type** — nuevo tipo semánticamente distinto de `RawRecord` para indicar que los datos ya fueron transformados. `RecordProcessorFn` ahora recibe `ParsedRecord`.
- [x] **`count()` antes de `start()`** — método para obtener el total de registros sin modificar estado. Útil para barras de progreso.
- [x] **`getStatus().status` en vez de `.state`** — campo `state` marcado como `@deprecated`. Nuevo campo `status` con el mismo valor.
- [x] **`itemTransform` para arrays** — transform aplicado a cada elemento individual después del split (ej: `.toLowerCase()` a cada zona).

---

## Deuda técnica

- [x] Extraer use cases de `BulkImport` facade a `application/usecases/` (StartImport, PreviewImport, PauseImport, ResumeImport, AbortImport, GetImportStatus)
- [x] Extraer lógica de batching como domain service reutilizable (`BatchSplitter`)
- [x] Mejorar coverage: InMemoryStateStore 63% → 100%, BulkImport branches 74% → 90%
- [x] Retry mechanism para registros fallidos (`maxRetries`, `retryDelayMs`, backoff exponencial, `record:retried` event)
