# todo.md — @bulkimport/core

Backlog de tareas pendientes. Las fases completadas se han eliminado para mantener el fichero limpio.

Fases completadas: 1 (Foundation), 2 (Happy Path), 3 (Validación), 4 (Control de flujo), 5 (Error handling), 6 (Persistencia de estado), 7 (Preview), 8 (Fuentes de datos), 9 (Eventos), 10 (Schema avanzado), 12 (Hardening), 13 (Publicación).

---

## Ideas de usuarios (bajo evaluación)

- [ ] **Modo upsert** — config de import mode: `'insert' | 'upsert' | 'update-only'` con `matchBy: ['identifier']`. Requiere decidir si es responsabilidad del domain model o solo un pass-through en el context del processor.
- [x] **SequelizeStateStore** — implementado como subpaquete `@bulkimport/state-sequelize` en `packages/state-sequelize/`. Compatible con Sequelize v6.
- [ ] **Adaptadores de StateStore adicionales** — PrismaStateStore, RedisStateStore. Evaluar si deben vivir en paquetes separados.

---

## Deuda técnica

- [ ] Extraer use cases de `BulkImport` facade a `application/usecases/` (CreateImportJob, StartImport, PauseImport, etc.)
- [ ] Extraer lógica de batching como domain service reutilizable
- [ ] Retry mechanism para registros fallidos
