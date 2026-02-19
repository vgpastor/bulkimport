# Changelog — @batchactions/state-prisma

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-02-19

### Fixed

- **JSON serialization** — All JSON fields (`config`, `batches`, `raw`, `parsed`, `errors`) are now serialized with `JSON.stringify()` in mappers for cross-database compatibility (works with both Prisma `Json` columns and `String`/`TEXT` columns).

### Changed

- **CI** — Added `test-state-prisma` job to CI workflow and dist verification.
- **Documentation** — Integrated into monorepo root README, core, distributed, and state-sequelize documentation.

## [0.0.1] - 2026-02-19

### Added

- Initial release.
- Implements `StateStore` and `DistributedStateStore` from `@batchactions/core`.
- Compatible with Prisma v6 and v7.
- CLI helper: `npx batchactions-prisma init` to add models to your schema.
- Atomic batch claiming with optimistic locking.
- Exactly-once job finalization via `tryFinalizeJob()`.
- Supports PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, CockroachDB.
