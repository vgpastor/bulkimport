# todo.md — @bulkimport/core

Backlog de tareas pendientes. Las fases completadas se han eliminado para mantener el fichero limpio.

Fases completadas: 1 (Foundation), 2 (Happy Path), 3 (Validación), 4 (Control de flujo), 5 (Error handling), 7 (Preview), 8 (Fuentes de datos — excepto UrlSource), 9 (Eventos), 10 (Schema avanzado — excepto template CSV generado como `BulkImport.generateTemplate()`), 12 (Hardening — excepto maxConcurrentBatches), 13 (Publicación).

---

## Pendiente: Persistencia de estado (Fase 6)

- [ ] Escribir test de aceptación: restaurar desde StateStore tras interrupción
- [ ] Implementar `FileStateStore` (JSON en disco)
- [ ] Implementar `BulkImport.restore(jobId, config)` — método estático para retomar imports interrumpidos
- [ ] Integrar StateStore completamente — actualmente `BulkImport` llama a `saveJobState()` pero NO usa `saveProcessedRecord()`, `getFailedRecords()` ni `getProgress()` del store

## Pendiente: Parsers y fuentes adicionales

- [ ] Implementar `XmlParser` (implementa `SourceParser`, puede usar fast-xml-parser)
- [ ] Implementar `UrlSource` (fetch desde URL)

## Pendiente: Hardening

- [ ] Implementar `maxConcurrentBatches` — declarado en config pero no implementado, los batches son secuenciales
- [ ] Tests de concurrencia con `maxConcurrentBatches > 1`

---

## Ideas de usuarios (bajo evaluación)

- [ ] **Modo upsert** — config de import mode: `'insert' | 'upsert' | 'update-only'` con `matchBy: ['identifier']`. Requiere decidir si es responsabilidad del domain model o solo un pass-through en el context del processor.
- [x] **SequelizeStateStore** — implementado como subpaquete `@bulkimport/state-sequelize` en `packages/state-sequelize/`. Compatible con Sequelize v6.
- [ ] **Adaptadores de StateStore adicionales** — PrismaStateStore, RedisStateStore. Evaluar si deben vivir en paquetes separados.

---

## Deuda técnica

- [ ] Extraer use cases de `BulkImport` facade a `application/usecases/` (CreateImportJob, StartImport, PauseImport, etc.)
- [ ] Extraer lógica de batching como domain service reutilizable
