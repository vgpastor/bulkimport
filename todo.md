# todo.md — @bulkimport/core

Backlog organizado por fases. Cada tarea tiene un estado:
- [x] Completado
- [ ] Pendiente

---

## Fase 1: Foundation

- [x] Inicializar proyecto con TypeScript y Vitest
- [x] Crear estructura de carpetas (domain, application, infrastructure)
- [x] Definir tipos e interfaces del dominio (model, ports, events)
- [x] Configurar `package.json` con dependencies y devDependencies
- [x] Configurar linting (ESLint 9 flat config: no-any, explicit-return-types, consistent-type-imports)
- [x] Configurar formatting (Prettier)
- [x] Crear `.editorconfig`
- [x] Crear `tsup.config.ts` para build
- [x] Crear LICENSE (MIT)
- [x] Crear `.gitignore`
- [x] Crear `.npmignore`
- [x] Crear README.md con ejemplos, tabla de compatibilidad y API reference
- [x] Crear CONTRIBUTING.md con guía de desarrollo y estándares
- [x] Verificar path aliases (no se usan en source, solo en tsconfig para IDE)
- [x] Ajustar compatibilidad: target ES2020, engines Node >= 16.7.0
- [x] Corregir errores de TypeScript preexistentes (`assertSourceConfigured` narrowing, `EventBus` cast)
- [x] Verificar build (tsup: ESM + CJS + .d.ts) y tests (40/40 passing)
- [x] Corregir orden de `types` en package.json exports (types first)

## Fase 2: Happy Path (Test 1)

- [x] Escribir test de aceptación: flujo completo happy path (25 records, batchSize 10)
- [x] Implementar `BulkImport` facade
- [x] Implementar `SchemaValidator`
- [x] Implementar `InMemoryStateStore`
- [x] Implementar `CsvParser` (con PapaParse)
- [x] Implementar `BufferSource`
- [x] Implementar motor de batching

## Fase 3: Validación (Tests 2 y 9)

- [x] Escribir test de aceptación: registros con errores de validación
- [x] Escribir test de aceptación: custom validator (NIF)
- [x] Implementar validación completa en SchemaValidator (todos los tipos: string, number, boolean, date, email, custom)
- [x] Escribir tests unitarios de SchemaValidator
- [x] Implementar `skipEmptyRows` en SchemaValidator — añadidos `isEmptyRow()` y `skipEmptyRows` getter en `SchemaValidator`, integrado en `BulkImport.processStreamBatch()` y `preview()`

## Fase 4: Control de flujo (Tests 3 y 4)

- [x] Escribir test de aceptación: pause y resume
- [x] Escribir test de aceptación: abort
- [x] Implementar máquina de estados (`ImportStatus` con transiciones válidas)
- [x] Escribir tests unitarios de ImportStatus
- [x] Implementar pause/resume con Promise pendiente
- [x] Implementar abort con AbortController

## Fase 5: Error handling (Test 5)

- [x] Escribir test de aceptación: error en processor del consumidor
- [x] Implementar `continueOnError` y tracking de errores

## Fase 6: Persistencia de estado (Test 6)

- [ ] Escribir test de aceptación: restaurar desde StateStore tras interrupción
- [ ] Implementar `FileStateStore` (JSON en disco)
- [ ] Implementar `BulkImport.restore(jobId, config)` — método estático para retomar imports interrumpidos
- [ ] Integrar StateStore completamente — actualmente `BulkImport` llama a `saveJobState()` pero NO usa `saveProcessedRecord()`, `getFailedRecords()` ni `getProgress()` del store. Los arrays en memoria son el source of truth, lo cual rompe el contrato del port

## Fase 7: Preview (Test 7)

- [x] Escribir test de aceptación: preview con registros inválidos
- [x] Implementar `preview()` con sampling

## Fase 8: Fuentes de datos (Test 8)

- [x] Escribir test de aceptación: múltiples fuentes producen mismo resultado
- [ ] Implementar `FilePathSource` (leer de ruta local, Node.js only) — crítico para imports de ficheros grandes (1M+ registros) donde `BufferSource` carga todo en memoria
- [ ] Implementar `StreamSource` (ReadableStream / AsyncIterable) — complementa `FilePathSource` para cuando el consumer ya tiene un stream (e.g. upload de Express/Fastify)
- [ ] Implementar `UrlSource` (fetch desde URL)

## Fase 9: Eventos (Test 10)

- [x] Escribir test de aceptación: eventos granulares en orden correcto
- [x] Implementar `EventBus`
- [x] Escribir tests unitarios de EventBus
- [x] Emitir todos los domain events desde BulkImport

## Fase 10: Schema avanzado (feedback de usuarios)

- [ ] Tipo de campo `array` con separador configurable — permite declarar campos como `{ name: 'authorizedZones', type: 'array', separator: ';' }` en vez de forzar al consumer a hacer split manual en el processor. Añadir `'array'` a `FieldType`, añadir `separator` a `FieldDefinition`, implementar parsing y validación en `SchemaValidator`
- [ ] Aliases de columnas — mapeo declarativo de headers alternativos: `{ name: 'documentNumber', aliases: ['document_number', 'Documento', 'DNI'] }`. Añadir `aliases?: readonly string[]` a `FieldDefinition`. Resolver aliases en la fase de parsing (antes de validar) para que el rest del pipeline trabaje con el nombre canónico. Este es el feature con más impacto según feedback (reduce soporte al usuario)
- [ ] Detección de duplicados intra-import — permitir declarar campos únicos en el schema: `{ fields: [...], uniqueFields: ['identifier'] }`. Añadir `uniqueFields?: readonly string[]` a `SchemaDefinition`. Implementar tracking de valores vistos y emitir error de validación si se detecta duplicado. Decidir si aplica por batch o por import completo (requiere acumular set de valores vistos)
- [ ] Generación de template CSV desde schema — método estático o de instancia que genere un CSV de ejemplo a partir del schema: `BulkImport.generateTemplate(schema)` → `"identifier,name,documentNumber,..."`. Permite al frontend pedir el template al backend y mantenerlo siempre sincronizado con el schema

## Fase 11: Parsers adicionales

- [ ] Implementar `JsonParser` (implementa `SourceParser`)
- [ ] Implementar `XmlParser` (implementa `SourceParser`, puede usar fast-xml-parser)
- [ ] Tests para cada parser

## Fase 12: Hardening

- [x] Streaming real — `start()` ahora parsea records lazily y procesa batch a batch sin materializar todo el fichero. Records liberados de memoria tras cada batch.
- [x] Corregir `percentage` en `buildProgress()` — ahora incluye `processed + failed` en el cálculo, imports con fallos llegan al 100%
- [x] Contadores O(1) — `buildProgress()` y `buildSummary()` usan contadores en vez de `allRecords.filter()`. Eliminado `allRecords[]`.
- [ ] Implementar `maxConcurrentBatches` — declarado en config pero no implementado, los batches son secuenciales
- [x] Tests de edge cases — fichero vacío, solo header, whitespace, BOM (string y Buffer), delimitadores (`;`, `\t`, `|`), autodetección, campos con comillas/newlines/escape, line endings (CRLF, CR, trailing), single record, batchSize > records, all records fail, skipEmptyRows
- [ ] Tests de concurrencia con `maxConcurrentBatches > 1`

## Fase 13: Publicación

- [x] README con ejemplos de uso, tabla de compatibilidad, ejemplo complejo (Express + PostgreSQL)
- [x] Verificar que el build genera correctamente ESM + CJS + .d.ts
- [x] Configurar npm publish (scope, access public) — publicado como `@bulkimport/core@0.1.0`
- [x] CI/CD — GitHub Actions: CI (lint, typecheck, test matrix Node 18/20/22, build) + Release (tag push → npm publish con OIDC provenance + GitHub Release)
- [ ] JSDoc en toda la API pública
- [ ] Añadir CHANGELOG

---

## Ideas de usuarios (bajo evaluación)

Features sugeridos por consumers que requieren más análisis de diseño antes de planificar:

- [ ] **Modo upsert** — config de import mode: `'insert' | 'upsert' | 'update-only'` con `matchBy: ['identifier']`. La lógica de persistencia la implementa cada consumer en su processor, pero la librería pasaría el `mode` en el context del processor y podría exponer un hook `onDuplicate`. Requiere decidir: ¿es responsabilidad del domain model o solo un pass-through en el context? ¿Añade acoplamiento con la capa de persistencia del consumer?
- [ ] **Adaptadores de StateStore para persistencia real** — SequelizeStateStore, PrismaStateStore, RedisStateStore. Útil para imports largos que sobrevivan a deploys/crashes. Prerequisito: completar la integración de StateStore (Fase 6). Evaluar si estos adaptadores deben vivir en este paquete o en paquetes separados (`@bulkimport/state-sequelize`, etc.) para no añadir dependencies opcionales

---

## Deuda técnica

- [ ] Extraer use cases de `BulkImport` facade a `application/usecases/` (CreateImportJob, StartImport, PauseImport, etc.) — actualmente toda la orquestación vive en una sola clase
- [ ] Extraer lógica de batching como domain service `BatchSplitter` — `splitIntoBatches` ya no existe (eliminado con el refactor de streaming), pero la lógica de acumulación en `batchBuffer` dentro de `start()` podría extraerse a un servicio de dominio reutilizable
- [x] ~~El record no debería retener datos tras ser procesado~~ — resuelto con streaming: records se liberan tras cada batch, solo `failedRecords` se retienen
- [x] ~~`markRecordProcessed` en `Record.ts`~~ — eliminado. No se exportaba en `index.ts` (no era API pública), no se usaba en ningún fichero. `RecordStatus: 'processed'` se mantiene en el tipo por compatibilidad con `InMemoryStateStore`
- [ ] `DataSource.sample()` en la spec recibe `maxRecords` y devuelve `AsyncIterable`, pero la implementación actual recibe `maxBytes` y devuelve `Promise<string | Buffer>`. Alinear con la spec o documentar la decisión
