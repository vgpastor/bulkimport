# Changelog — @batchactions/state-sequelize

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-02-18

### Changed

- **Package rename & version downgrade** — Package renamed from `@bulkimport/state-sequelize` to `@batchactions/state-sequelize`. Version numbers reset to `0.0.x` to reflect the new package scope. This is a **downgrade in version number only** — all functionality from the previous releases under `@bulkimport/state-sequelize` is preserved.
- **BREAKING: Database table names renamed** — Tables have been renamed from `bulkimport_*` to `batchactions_*` to match the new package naming:
  - `bulkimport_jobs` → `batchactions_jobs`
  - `bulkimport_records` → `batchactions_records`
  - `bulkimport_batches` → `batchactions_batches`
  - **Migration required:** If upgrading from `@bulkimport/state-sequelize`, rename existing tables before updating (e.g. `ALTER TABLE bulkimport_jobs RENAME TO batchactions_jobs;`).

---

## Historical Changelog (under previous `@bulkimport/state-sequelize` package name)

> The entries below document the development history under the original `@bulkimport/state-sequelize` name.
> All functionality is carried forward into `@batchactions/state-sequelize`.

---

## [0.5.0] - 2026-02-17

### Added

- **`@bulkimport/state-sequelize` distributed support** — `SequelizeStateStore` now implements `DistributedStateStore`. New `bulkimport_batches` table for distributed batch metadata. Atomic batch claiming with optimistic locking (`version` column). `reclaimStaleBatches()` for timeout-based recovery of crashed workers. `tryFinalizeJob()` for exactly-once completion detection. 26 new integration tests (79 total).

## [0.2.0] - 2026-02-15

### Added

- **`@bulkimport/state-sequelize`** — initial release implementing `StateStore` port with Sequelize v6. Persists job state and processed records to any SQL database (PostgreSQL, MySQL, SQLite, etc.). 40 tests (unit + integration with SQLite in-memory).
