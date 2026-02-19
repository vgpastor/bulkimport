# Changelog — @batchactions/import

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.4] - 2026-02-19

### Changed

- **Documentation** — Updated README references to include `@batchactions/state-prisma`.

## [0.0.2] - 2026-02-18

### Changed

- **Package rename & version downgrade** — Package renamed from `@bulkimport/import` to `@batchactions/import`. Version numbers reset to `0.0.x` to reflect the new package scope. This is a **downgrade in version number only** — all functionality from the previous releases under `@bulkimport/*` is preserved.

### Notes

- This package was extracted from `@bulkimport/core` and contains the import-specific layer: schema validation, parsers (CSV, JSON, XML), data sources, and template generation.
- The import functionality was previously part of `@bulkimport/core` versions 0.1.0 through 0.5.0. See the `@batchactions/core` CHANGELOG for the full historical record.
