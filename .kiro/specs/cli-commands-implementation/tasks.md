# Implementation Plan: CLI Commands Implementation

## Overview

Replace the four stub CLI command handlers (`init`, `jobs`, `use`, `ingest`) with working implementations following hexagonal architecture. Build bottom-up: domain models → port interface → domain services → outbound adapter → inbound handlers. All operations are local filesystem only.

## Tasks

- [ ] 1. Create domain models and Zod schemas
  - [ ] 1.1 Create `src/domain/models/job.ts` with all Zod schemas and types
    - Define `jobNameSchema` with regex `^[a-z0-9][a-z0-9_-]*$`, min 1, max 128
    - Define `jobStatusSchema` as enum `['empty', 'initialized', 'ingested']`
    - Define `jobSchema` with `name`, `status`, `isActive` fields
    - Define `manifestEntrySchema` with `filename`, `recipeName`, `sourceCollection`, `imageType`, `notes` fields (defaults to empty string)
    - Define `SUPPORTED_IMAGE_EXTENSIONS` set
    - Export all schemas, inferred types, and constants
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 1.1_

  - [ ] 1.2 Update `src/domain/models/index.ts` barrel file
    - Re-export everything from `./job.js`
    - _Requirements: 8.4_

  - [ ] 1.3 Write property test for job name validation (`src/domain/models/job.pbt.ts`)
    - **Property 1: Job name validation is consistent with the pattern**
    - Use `fast-check` to generate arbitrary strings and verify `jobNameSchema` accepts iff the string matches `^[a-z0-9][a-z0-9_-]*$` and length is 1–128
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [ ] 1.4 Write unit tests for domain models (`src/domain/models/job.unit.ts`)
    - Test `jobNameSchema` accepts valid names and rejects invalid ones (empty, too long, uppercase, special chars, leading hyphen)
    - Test `manifestEntrySchema` defaults and validation
    - Test `SUPPORTED_IMAGE_EXTENSIONS` contains all expected extensions
    - _Requirements: 8.1, 8.2, 8.3, 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Create FileSystemPort interface and NodeFileSystemAdapter
  - [ ] 2.1 Create `src/domain/ports/file-system-port.ts` with the `FileSystemPort` interface
    - Define `createDirectory(path: string): Promise<void>`
    - Define `exists(path: string): Promise<boolean>`
    - Define `listDirectory(path: string): Promise<string[]>`
    - Define `readFile(path: string): Promise<string>`
    - Define `writeFile(path: string, content: string): Promise<void>`
    - _Requirements: 7.1, 7.4_

  - [ ] 2.2 Update `src/domain/ports/index.ts` barrel file
    - Re-export everything from `./file-system-port.js`
    - _Requirements: 7.1_

  - [ ] 2.3 Create `src/adapters/outbound/node-file-system-adapter.ts` implementing `FileSystemPort`
    - Implement `createDirectory` using `fs.mkdir` with `{ recursive: true }`
    - Implement `exists` using `fs.access` with catch returning `false`
    - Implement `listDirectory` using `fs.readdir`
    - Implement `readFile` using `fs.readFile` with `'utf-8'` encoding
    - Implement `writeFile` using `fs.writeFile`
    - _Requirements: 7.2, 7.3_

  - [ ] 2.4 Update `src/adapters/outbound/index.ts` barrel file
    - Re-export `NodeFileSystemAdapter` from `./node-file-system-adapter.js`
    - _Requirements: 7.2_

- [ ] 3. Implement CSV utilities
  - [ ] 3.1 Create `src/domain/services/csv-utils.ts`
    - Define `MANIFEST_COLUMNS` constant array: `['filename', 'recipe_name', 'source_collection', 'image_type', 'notes']`
    - Implement `serializeManifest(entries: ManifestEntry[]): string` — RFC 4180 CSV with header row, LF line endings, proper quoting for commas/quotes/newlines
    - Implement `parseManifest(csv: string): ManifestEntry[]` — parse CSV back to `ManifestEntry[]`, handle quoted fields
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 3.2 Write property test for CSV round-trip (`src/domain/services/csv-utils.pbt.ts`)
    - **Property 9: CSV serialization round-trip**
    - Generate arbitrary arrays of `ManifestEntry` objects (including special characters: commas, quotes, newlines)
    - Verify `parseManifest(serializeManifest(entries))` deeply equals the original input
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [ ] 3.3 Write unit tests for CSV utilities (`src/domain/services/csv-utils.unit.ts`)
    - Test header row is present and correct
    - Test quoting of fields with commas, double quotes, and newlines
    - Test empty entries array produces header-only output
    - Test round-trip with typical manifest data
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 4. Checkpoint — Verify foundation layers
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement JobService
  - [ ] 5.1 Create `src/domain/services/job-service.ts` with the `JobService` class
    - Constructor takes `FileSystemPort` and `jobsRoot` (default `'jobs'`)
    - Implement `validateJobName(name: string): void` — parse with `jobNameSchema`, throw `HeirloomError` on failure
    - Implement `createJob(name: string): Promise<void>` — validate name, check if job dir exists (throw if so), create `jobs/<name>/images/`
    - Implement `listJobs(): Promise<Job[]>` — read `jobs/` entries, derive status for each (check `manifest.csv` → `ingested`, check `images/` → `initialized`, else `empty`), read `.active-job` to mark active
    - Implement `getActiveJob(): Promise<string | undefined>` — read `jobs/.active-job` if exists, return `undefined` otherwise
    - Implement `setActiveJob(name: string): Promise<void>` — validate name, check job dir exists (throw if not), write name to `jobs/.active-job`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.5, 3.1, 3.4, 4.1, 4.2, 4.5_

  - [ ] 5.2 Write property tests for JobService (`src/domain/services/job-service.pbt.ts`)
    - **Property 2: Init creates the correct directory structure**
    - **Property 3: Init rejects duplicate jobs**
    - **Property 4: Job status derivation from filesystem state**
    - **Property 5: Use command persists active job**
    - **Property 6: Use command rejects non-existent jobs**
    - Use mock `FileSystemPort` that records calls and returns configurable responses
    - **Validates: Requirements 2.1, 2.2, 2.5, 3.4, 4.1, 4.2, 4.5**

  - [ ] 5.3 Write unit tests for JobService (`src/domain/services/job-service.unit.ts`)
    - Test `createJob` success path and duplicate rejection
    - Test `listJobs` with various filesystem states (empty, mixed statuses, with active job)
    - Test `getActiveJob` when set and when not set
    - Test `setActiveJob` success and non-existent job error
    - Test `validateJobName` with valid and invalid names
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.4, 4.1, 4.2_

- [ ] 6. Implement IngestService
  - [ ] 6.1 Create `src/domain/services/ingest-service.ts` with the `IngestService` class
    - Constructor takes `FileSystemPort`
    - Implement `ingest(jobDir: string): Promise<{ discovered: number; total: number }>` — scan `<jobDir>/images/` for supported extensions, read existing `manifest.csv` if present, merge new entries preserving existing annotations, sort alphabetically by filename, write result, return counts
    - Use `SUPPORTED_IMAGE_EXTENSIONS` from domain models to filter files
    - Use `parseManifest` / `serializeManifest` from csv-utils for manifest I/O
    - Throw `HeirloomError` if no image files found
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.7, 5.8_

  - [ ] 6.2 Write property tests for IngestService (`src/domain/services/ingest-service.pbt.ts`)
    - **Property 7: Ingest produces a correct manifest from image files**
    - **Property 8: Manifest merge preserves annotations and avoids duplicates**
    - Use mock `FileSystemPort` with configurable directory listings and file contents
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.7, 5.8**

  - [ ] 6.3 Write unit tests for IngestService (`src/domain/services/ingest-service.unit.ts`)
    - Test fresh ingest with mixed image and non-image files
    - Test merge with existing manifest preserving annotations
    - Test no-images error case
    - Test alphabetical sorting of manifest entries
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.7, 5.8_

  - [ ] 6.4 Update `src/domain/services/index.ts` barrel file
    - Re-export from `./job-service.js`, `./ingest-service.js`, and `./csv-utils.js`
    - _Requirements: 7.4_

- [ ] 7. Checkpoint — Verify domain layer
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement inbound handlers
  - [ ] 8.1 Rewrite `src/adapters/inbound/init-handler.ts`
    - Replace stub with real implementation
    - Parse job name from `args[0]`, error if missing
    - Construct `NodeFileSystemAdapter` and `JobService`
    - Call `jobService.createJob(name)`
    - Print confirmation message with job name and images path on success
    - Catch `HeirloomError`, print message to stderr, set `process.exitCode = 1`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 9.1, 9.2_

  - [ ] 8.2 Rewrite `src/adapters/inbound/jobs-handler.ts`
    - Replace stub with real implementation
    - Construct `NodeFileSystemAdapter` and `JobService`
    - Call `jobService.listJobs()`
    - Handle case where `jobs/` directory doesn't exist (print "no jobs" message)
    - Print each job with name, status, and active indicator
    - Print message if no jobs found
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.1_

  - [ ] 8.3 Rewrite `src/adapters/inbound/use-handler.ts`
    - Replace stub with real implementation
    - Parse job name from `args[0]`, error if missing
    - Construct `NodeFileSystemAdapter` and `JobService`
    - Call `jobService.setActiveJob(name)`
    - Print confirmation message with selected job name on success
    - Catch `HeirloomError`, print message to stderr, set `process.exitCode = 1`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 9.1, 9.2_

  - [ ] 8.4 Rewrite `src/adapters/inbound/ingest-handler.ts`
    - Replace stub with real implementation
    - Construct `NodeFileSystemAdapter`, `JobService`, and `IngestService`
    - Call `jobService.getActiveJob()`, error if no active job with suggestion to run `heirloom use <job-name>`
    - Call `ingestService.ingest(jobDir)` with the active job's directory path
    - Print summary with discovered and total counts on success
    - Catch `HeirloomError`, print message to stderr, set `process.exitCode = 1`
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 9.1, 9.2_

  - [ ] 8.5 Write unit tests for init-handler (`src/adapters/inbound/init-handler.unit.ts`)
    - Test success output message
    - Test missing job name argument error
    - Test duplicate job error output
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 9.1_

  - [ ] 8.6 Write unit tests for jobs-handler (`src/adapters/inbound/jobs-handler.unit.ts`)
    - Test listing output with multiple jobs and statuses
    - Test empty state message
    - Test active job indicator in output
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [ ] 8.7 Write unit tests for use-handler (`src/adapters/inbound/use-handler.unit.ts`)
    - Test success output message
    - Test missing job name argument error
    - Test non-existent job error output
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 9.1_

  - [ ] 8.8 Write unit tests for ingest-handler (`src/adapters/inbound/ingest-handler.unit.ts`)
    - Test success output with counts
    - Test no active job error with suggestion message
    - Test no images found error output
    - _Requirements: 5.1, 5.4, 5.5, 9.1_

- [ ] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All domain services depend only on `FileSystemPort` — no direct `fs` imports in domain layer
- Handlers construct adapters and services directly (no DI container)
