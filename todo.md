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
- [ ] Implementar `skipEmptyRows` en SchemaValidator (declarado en `SchemaDefinition` pero no usado)

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
- [ ] Implementar `FilePathSource` (leer de ruta local, Node.js only)
- [ ] Implementar `StreamSource` (ReadableStream / AsyncIterable)
- [ ] Implementar `UrlSource` (fetch desde URL)

## Fase 9: Eventos (Test 10)

- [x] Escribir test de aceptación: eventos granulares en orden correcto
- [x] Implementar `EventBus`
- [x] Escribir tests unitarios de EventBus
- [x] Emitir todos los domain events desde BulkImport

## Fase 10: Parsers adicionales

- [ ] Implementar `JsonParser` (implementa `SourceParser`)
- [ ] Implementar `XmlParser` (implementa `SourceParser`, puede usar fast-xml-parser)
- [ ] Tests para cada parser

## Fase 11: Hardening

- [ ] Streaming real — `parseRecords()` actualmente carga todo en memoria antes de crear batches. Debe procesar batch a batch sin materializar todo el fichero
- [ ] Implementar `maxConcurrentBatches` — declarado en config pero no implementado, los batches son secuenciales
- [ ] Corregir `percentage` en `buildProgress()` — solo cuenta `processed`, no `failed`, así que imports con fallos nunca llegan al 100%
- [ ] Tests de edge cases: fichero vacío, fichero enorme (streaming), encodings especiales, BOM, delimitadores raros
- [ ] Tests de concurrencia con `maxConcurrentBatches > 1`

## Fase 12: Publicación

- [x] README con ejemplos de uso, tabla de compatibilidad, ejemplo complejo (Express + PostgreSQL)
- [x] Verificar que el build genera correctamente ESM + CJS + .d.ts
- [ ] JSDoc en toda la API pública
- [ ] Configurar npm publish (scope, access public)
- [ ] Añadir CHANGELOG

---

## Deuda técnica

- [ ] Extraer use cases de `BulkImport` facade a `application/usecases/` (CreateImportJob, StartImport, PauseImport, etc.) — actualmente toda la orquestación vive en una sola clase
- [ ] Extraer `BatchSplitter` como domain service (actualmente es un método privado en `BulkImport`)
- [ ] El record no debería retener datos tras ser procesado — la spec dice que los records pasan por el callback y se descartan de memoria. Actualmente `allRecords` en `BulkImport` los retiene todos
- [ ] `DataSource.sample()` en la spec recibe `maxRecords` y devuelve `AsyncIterable`, pero la implementación actual recibe `maxBytes` y devuelve `Promise<string | Buffer>`. Alinear con la spec o documentar la decisión
