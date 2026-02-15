# todo.md — @bulkimport/core

Backlog de tareas pendientes. Las fases completadas se han eliminado para mantener el fichero limpio.

Fases completadas: 1 (Foundation), 2 (Happy Path), 3 (Validación), 4 (Control de flujo), 5 (Error handling), 6 (Persistencia de estado), 7 (Preview), 8 (Fuentes de datos), 9 (Eventos), 10 (Schema avanzado), 12 (Hardening), 13 (Publicación), 14 (Performance & Memory), 15 (Code Quality & Deduplication).

---

## Ideas de usuarios (bajo evaluación)

- [ ] **Modo upsert** — config de import mode: `'insert' | 'upsert' | 'update-only'` con `matchBy: ['identifier']`. Requiere decidir si es responsabilidad del domain model o solo un pass-through en el context del processor.
- [x] **SequelizeStateStore** — implementado como subpaquete `@bulkimport/state-sequelize` en `packages/state-sequelize/`. Compatible con Sequelize v6.
- [ ] **Adaptadores de StateStore adicionales** — PrismaStateStore, RedisStateStore. Evaluar si deben vivir en paquetes separados.

---

## Deuda técnica

- [x] Extraer use cases de `BulkImport` facade a `application/usecases/` (StartImport, PreviewImport, PauseImport, ResumeImport, AbortImport, GetImportStatus)
- [x] Extraer lógica de batching como domain service reutilizable (`BatchSplitter`)
- [x] Mejorar coverage: InMemoryStateStore 63% → 100%, BulkImport branches 74% → 90%
- [ ] Retry mechanism para registros fallidos
