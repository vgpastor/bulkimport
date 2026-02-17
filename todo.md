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
- [x] **`processChunk()` modo serverless** — procesamiento por chunks con límites de tiempo (`maxDurationMs`) y records (`maxRecords`). Chunk boundary a nivel de batch. Diseñado para Vercel/Lambda con timeouts de 30s.
- [x] **Hooks pre/post record** — 4 hooks opcionales en el pipeline: `beforeValidate`, `afterValidate`, `beforeProcess`, `afterProcess`. Permiten enriquecimiento, modificación de errores, y side effects post-procesamiento.
- [x] **DuplicateChecker port** — detección de duplicados contra fuentes externas (DB, API). Comprueba solo registros que pasan validación interna. Error code `EXTERNAL_DUPLICATE`. Batch-optimized `checkBatch()` optional.
- [x] **Errores extensibles** — `severity` (`error`/`warning`), `category`, `suggestion`, `metadata` opcionales en `ValidationError`. Helpers `hasErrors()`, `getWarnings()`, `getErrors()`. Warnings son non-blocking (el record pasa al processor).
- [x] **Procesamiento distribuido paralelo** — `@bulkimport/distributed` package para fan-out de N workers (AWS Lambda, etc.). Modelo de dos fases: orquestador `prepare()` materializa records + N workers `processWorkerBatch()` reclaman batches con locking atómico. Recovery: `reclaimStaleBatches()` para timeout-based reclaim. Exactly-once finalization vía `tryFinalizeJob()`. Implementado en `SequelizeStateStore` como `DistributedStateStore`.

---

## Deuda técnica

- [x] Extraer use cases de `BulkImport` facade a `application/usecases/` (StartImport, PreviewImport, PauseImport, ResumeImport, AbortImport, GetImportStatus)
- [x] Extraer lógica de batching como domain service reutilizable (`BatchSplitter`)
- [x] Mejorar coverage: InMemoryStateStore 63% → 100%, BulkImport branches 74% → 90%
- [x] Retry mechanism para registros fallidos (`maxRetries`, `retryDelayMs`, backoff exponencial, `record:retried` event)
