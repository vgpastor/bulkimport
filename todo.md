# todo.md — @batchactions monorepo

Backlog de tareas pendientes. Las fases completadas se han eliminado para mantener el fichero limpio.

Fases completadas: 1–15 (Foundation → Code Quality & Deduplication), 16 (Monorepo refactor @bulkimport → @batchactions).

---

## Ideas de usuarios (bajo evaluación)

- [ ] **Modo upsert** — config de import mode: `'insert' | 'upsert' | 'update-only'` con `matchBy: ['identifier']`. Requiere decidir si es responsabilidad del domain model o solo un pass-through en el context del processor.
- [ ] **Adaptadores de StateStore adicionales** — PrismaStateStore, RedisStateStore. Evaluar si deben vivir en paquetes separados.

---

## Deuda técnica

- [x] ~~Migrar table names de `bulkimport_*` a `batchactions_*` en `@batchactions/state-sequelize`~~ *(v0.0.2 — 2026-02-18)*
- [x] ~~Publicar paquetes `@batchactions/core`, `@batchactions/import`, `@batchactions/distributed`, `@batchactions/state-sequelize` a npm~~ *(v0.0.2 — 2026-02-18)*
- [x] ~~Actualizar CI/CD pipeline (GitHub Actions) para monorepo con 4 paquetes~~ *(release workflows configurados)*
- [x] ~~Crear CLAUDE.md por paquete para contextos más granulares~~ *(v0.0.2 — 2026-02-18)*

