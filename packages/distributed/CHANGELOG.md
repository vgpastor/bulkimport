# Changelog — @batchactions/distributed

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-02-18

### Changed

- **Package rename & version downgrade** — Package renamed from `@bulkimport/distributed` to `@batchactions/distributed`. Version numbers reset to `0.0.x` to reflect the new package scope. This is a **downgrade in version number only** — all functionality from the previous releases under `@bulkimport/distributed` is preserved.

---

## Historical Changelog (under previous `@bulkimport/distributed` package name)

> The entries below document the development history under the original `@bulkimport/distributed` name.
> All functionality is carried forward into `@batchactions/distributed`.

---

## [0.5.0] - 2026-02-17

### Added

- **`@bulkimport/distributed` package** (`packages/distributed/`) — new npm package for distributed multi-worker batch processing. Two-phase model: orchestrator calls `prepare()` (streams source, materializes records in StateStore, creates batch metadata), then N workers call `processWorkerBatch()` (claims batch atomically, processes records, finalizes job on last batch). `DistributedImport` facade, `PrepareDistributedImport` and `ProcessDistributedBatch` use cases. 13 acceptance tests. `peerDependency` on `@bulkimport/core >= 0.4.0`.
