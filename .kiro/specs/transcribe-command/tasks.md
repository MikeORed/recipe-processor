# Implementation Plan: Transcribe Command

## Overview

Implement the transcribe command (step 3 of the Heirloom pipeline) following the project's hexagonal architecture. The plan proceeds bottom-up: domain models and port interfaces first, then the core `TranscribeService`, outbound AWS adapters, the inbound CLI handler, and finally CDK infrastructure. Each task builds on the previous, and property-based tests are placed close to the code they validate.

## Tasks

- [ ] 1. Extend domain models and port interfaces
  - [ ] 1.1 Extend `jobStatusSchema` with `transcribing` and `transcribed` statuses
    - In `src/domain/models/job.ts`, update the `jobStatusSchema` enum to include `'transcribing'` and `'transcribed'`
    - Verify existing code that references `JobStatus` still compiles
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 1.2 Create the Recipe domain model
    - Create `src/domain/models/recipe.ts` with `confidenceScoreSchema`, `recipeSchema`, and `Recipe` type as defined in the design
    - Export from `src/domain/models/index.ts`
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 1.3 Write unit tests for the Recipe model
    - Create `src/domain/models/recipe.unit.ts`
    - Test schema accepts valid Recipe objects
    - Test schema rejects missing required fields (title, ingredients, instructions, jobName, recipeNumber)
    - Test schema rejects confidence scores outside [0, 1]
    - Test schema rejects empty title, empty ingredients/instructions arrays
    - Test default value for `notes` field
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 1.4 Write property test for confidence score boundary validation
    - Create `src/domain/models/recipe.pbt.ts`
    - **Property 5: Confidence score boundary validation**
    - Generate random numbers with `fast-check`, verify `recipeSchema` accepts scores in [0, 1] and rejects scores outside that range
    - Minimum 100 iterations
    - **Validates: Requirements 10.3**

  - [ ]* 1.5 Write property test for Recipe JSON round-trip
    - In `src/domain/models/recipe.pbt.ts`
    - **Property 6: Recipe JSON round-trip**
    - Generate valid Recipe objects with `fast-check`, serialize via `JSON.stringify`, parse back through `recipeSchema`, verify deep equality
    - Minimum 100 iterations
    - **Validates: Requirements 10.4**

  - [ ] 1.6 Create domain port interfaces
    - Create `src/domain/ports/object-store-port.ts` with `ObjectStore` interface (`upload`, `exists`)
    - Create `src/domain/ports/ocr-provider-port.ts` with `TextBlock`, `OCRResult`, and `OCRProvider` interfaces
    - Create `src/domain/ports/structure-extractor-port.ts` with `ExtractionInput` and `StructureExtractor` interfaces
    - Create `src/domain/ports/data-store-port.ts` with `DataStore` interface (`putRecipe`, `getRecipesByJob`, `updateJobStatus`, `getJobStatus`)
    - Export all new ports from `src/domain/ports/index.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 2. Implement TranscribeService
  - [ ] 2.1 Create the TranscribeService with core transcription logic
    - Create `src/domain/services/transcribe-service.ts`
    - Constructor accepts `FileSystemPort`, `ObjectStore`, `OCRProvider`, `StructureExtractor`, `DataStore`
    - Implement `transcribe(jobName, jobDir)` method:
      - Read and parse manifest CSV via `FileSystemPort` and existing `parseManifest`
      - Filter entries with non-empty `recipeNumber`, track skipped count
      - Throw `HeirloomError` if no annotated entries found
      - Group entries by `recipeNumber`
      - Update job status to `transcribing` via `DataStore`
      - For each recipe group: upload images (idempotent), run OCR, combine text, extract structure, persist recipe
      - S3 key pattern: `<jobName>/<filename>`
      - Update job status to `transcribed` on success, revert to `ingested` on total failure
      - Return `TranscriptionResult` with counts and errors
    - Export `TranscriptionResult` interface and `TranscribeService` class
    - Export from `src/domain/services/index.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.4, 5.1, 5.6, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 13.1, 13.2, 13.3_

  - [ ]* 2.2 Write unit tests for TranscribeService
    - Create `src/domain/services/transcribe-service.unit.ts`
    - Mock all five port dependencies
    - Test manifest reading and filtering (empty recipeNumber entries skipped)
    - Test error when no annotated entries found
    - Test grouping by recipeNumber
    - Test upload key construction (`<jobName>/<filename>`)
    - Test idempotent upload skip (exists → no upload call)
    - Test OCR error handling (skip image, continue with group)
    - Test extraction error handling (skip group, continue with others)
    - Test Zod validation failure handling (skip group)
    - Test job status transitions: ingested → transcribing → transcribed
    - Test job status revert to `ingested` on total failure
    - Test summary result accuracy (recipesTranscribed, entriesSkipped, errors)
    - Test re-run on `transcribed` job re-processes all entries
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.4, 5.1, 5.6, 6.1, 6.4, 7.1, 7.2, 7.3, 7.4, 13.1, 13.2, 13.3_

  - [ ]* 2.3 Write property test for manifest filtering and grouping
    - Create `src/domain/services/transcribe-service.pbt.ts`
    - **Property 1: Manifest filtering and grouping**
    - Generate random manifests with a mix of empty and non-empty `recipeNumber` fields
    - Verify: (a) every entry in each group shares the same non-empty `recipeNumber`, (b) no entries with non-empty `recipeNumber` are lost, (c) filtered-out count equals entries with empty `recipeNumber`
    - Minimum 100 iterations
    - **Validates: Requirements 2.2, 2.4**

  - [ ]* 2.4 Write property test for upload key pattern
    - In `src/domain/services/transcribe-service.pbt.ts`
    - **Property 2: Upload key pattern**
    - Generate random job names and image filenames, verify key equals `<jobName>/<filename>`
    - Minimum 100 iterations
    - **Validates: Requirements 3.1**

  - [ ]* 2.5 Write property test for idempotent upload skip
    - In `src/domain/services/transcribe-service.pbt.ts`
    - **Property 3: Idempotent upload skip**
    - Generate random exists/not-exists states for image keys, verify upload is called only when key does not exist
    - Minimum 100 iterations
    - **Validates: Requirements 3.3, 13.2**

  - [ ]* 2.6 Write property test for recipe metadata from manifest
    - In `src/domain/services/transcribe-service.pbt.ts`
    - **Property 4: Recipe metadata from manifest**
    - Generate random manifest entry groups with jobName, recipeNumber, source; verify persisted Recipe carries the same values
    - Minimum 100 iterations
    - **Validates: Requirements 6.3**

  - [ ]* 2.7 Write property test for fault isolation across recipe groups
    - In `src/domain/services/transcribe-service.pbt.ts`
    - **Property 7: Fault isolation across recipe groups**
    - Generate random sets of recipe groups where a subset fail during OCR or extraction; verify all non-failing groups are still processed and persisted
    - Minimum 100 iterations
    - **Validates: Requirements 13.3**

- [ ] 3. Checkpoint — Core domain layer
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement outbound adapters
  - [ ] 4.1 Implement S3Adapter
    - Create `src/adapters/outbound/s3-adapter.ts` implementing `ObjectStore`
    - Use `@aws-sdk/client-s3` (`PutObjectCommand`, `HeadObjectCommand`)
    - Read bucket name and region from convict config
    - `upload()`: read file from local path via `fs.readFile`, PUT to S3
    - `exists()`: HEAD object, return true if 200, false if `NotFound`
    - _Requirements: 9.1, 9.5_

  - [ ]* 4.2 Write unit tests for S3Adapter
    - Create `src/adapters/outbound/s3-adapter.unit.ts`
    - Mock `@aws-sdk/client-s3` client
    - Test `upload()` sends correct bucket, key, and body
    - Test `exists()` returns true on success, false on `NotFound` error
    - Test config values are read from convict
    - _Requirements: 9.1, 9.5_

  - [ ] 4.3 Implement TextractAdapter
    - Create `src/adapters/outbound/textract-adapter.ts` implementing `OCRProvider`
    - Use `@aws-sdk/client-textract` (`StartDocumentTextDetection`, `GetDocumentTextDetection`)
    - Async polling: start job, poll until complete, collect LINE blocks
    - Normalize Textract confidence (0–100) to 0.0–1.0
    - Read S3 bucket name and region from convict config
    - _Requirements: 9.2, 9.5_

  - [ ]* 4.4 Write unit tests for TextractAdapter
    - Create `src/adapters/outbound/textract-adapter.unit.ts`
    - Mock `@aws-sdk/client-textract` client
    - Test job start with correct S3 bucket and key
    - Test polling loop handles `IN_PROGRESS` then `SUCCEEDED` states
    - Test confidence normalization (divide by 100)
    - Test error handling for failed jobs
    - _Requirements: 9.2, 9.5_

  - [ ] 4.5 Implement BedrockAdapter
    - Create `src/adapters/outbound/bedrock-adapter.ts` implementing `StructureExtractor`
    - Use `@aws-sdk/client-bedrock-runtime` (`InvokeModelCommand`)
    - Build 0-shot prompt with OCR text and metadata
    - Parse JSON response and validate against `recipeSchema` with Zod
    - Throw `HeirloomError` on validation failure
    - Read model ID and region from convict config
    - _Requirements: 9.3, 9.5_

  - [ ]* 4.6 Write unit tests for BedrockAdapter
    - Create `src/adapters/outbound/bedrock-adapter.unit.ts`
    - Mock `@aws-sdk/client-bedrock-runtime` client
    - Test prompt construction includes OCR text, recipeNumber, source, jobName
    - Test valid JSON response is parsed and validated against `recipeSchema`
    - Test invalid JSON response throws `HeirloomError`
    - Test Zod validation failure throws `HeirloomError`
    - _Requirements: 9.3, 9.5_

  - [ ] 4.7 Implement DynamoDBAdapter
    - Create `src/adapters/outbound/dynamodb-adapter.ts` implementing `DataStore`
    - Use `@aws-sdk/lib-dynamodb` (`PutCommand`, `GetCommand`, `QueryCommand`)
    - `putRecipe()`: PutItem to recipes table (PK: `jobName`, SK: `recipeNumber`)
    - `getRecipesByJob()`: Query recipes table by `jobName`
    - `updateJobStatus()`: PutItem to jobs table (PK: `jobName`)
    - `getJobStatus()`: GetItem from jobs table
    - Read table names and region from convict config
    - Export from `src/adapters/outbound/index.ts`
    - _Requirements: 9.4, 9.5_

  - [ ]* 4.8 Write unit tests for DynamoDBAdapter
    - Create `src/adapters/outbound/dynamodb-adapter.unit.ts`
    - Mock `@aws-sdk/lib-dynamodb` client
    - Test `putRecipe()` sends correct table name, PK, SK, and item
    - Test `getRecipesByJob()` queries with correct key condition
    - Test `updateJobStatus()` writes to jobs table with correct PK
    - Test `getJobStatus()` returns status or undefined when not found
    - _Requirements: 9.4, 9.5_

- [ ] 5. Checkpoint — Adapters
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Wire up the transcribe-handler
  - [ ] 6.1 Implement the transcribe-handler
    - Replace the stub in `src/adapters/inbound/transcribe-handler.ts`
    - Wire `NodeFileSystemAdapter`, `S3Adapter`, `TextractAdapter`, `BedrockAdapter`, `DynamoDBAdapter` to `TranscribeService`
    - Validate active job exists via `JobService.getActiveJob()`
    - Validate job status is `ingested` or `transcribed` (allow re-run per Req 13.1)
    - Print job name and recipe group count at start
    - Print progress per recipe group
    - Print summary (recipes transcribed, entries skipped, elapsed time)
    - Handle `HeirloomError` → print message + `process.exitCode = 1`
    - Handle unexpected errors → re-throw for CLI runner
    - _Requirements: 1.1, 1.2, 1.3, 12.1, 12.2, 12.3, 12.4, 13.1_

  - [ ]* 6.2 Write unit tests for transcribe-handler
    - Update `src/adapters/inbound/transcribe-handler.unit.ts`
    - Mock `JobService`, `TranscribeService`, and all adapter constructors
    - Test no active job → error message + exit code 1
    - Test wrong job status → error message + exit code 1
    - Test happy path → calls TranscribeService, prints progress and summary
    - Test `HeirloomError` from service → prints message + exit code 1
    - _Requirements: 1.1, 1.2, 1.3, 12.1, 12.2, 12.3, 12.4_

- [ ] 7. Checkpoint — CLI handler
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Add CDK infrastructure
  - [ ] 8.1 Add stateful resources to StatefulStack
    - In `infra/stateful/stateful-stack.ts`, add:
      - S3 bucket (`heirloom-images`) with `RETAIN` removal policy
      - DynamoDB Recipes table (`heirloom-recipes`): PK `jobName` (S), SK `recipeNumber` (S), `RETAIN`
      - DynamoDB Jobs table (`heirloom-jobs`): PK `jobName` (S), `RETAIN`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ] 8.2 Add IAM policies to StatelessStack
    - In `infra/stateless/stateless-stack.ts`, add scoped IAM policies for:
      - S3: `PutObject`, `GetObject`, `HeadObject` on the images bucket
      - DynamoDB: `PutItem`, `GetItem`, `Query` on recipes and jobs tables
      - Textract: `StartDocumentTextDetection`, `GetDocumentTextDetection`
      - Bedrock: `InvokeModel` on the configured model ARN
    - _Requirements: 11.5_

  - [ ]* 8.3 Write CDK assertion tests
    - Create `test/stateful-stack.test.ts`
    - Assert S3 bucket exists with RETAIN removal policy
    - Assert DynamoDB Recipes table has correct key schema (PK: `jobName`, SK: `recipeNumber`) and RETAIN policy
    - Assert DynamoDB Jobs table has correct key schema (PK: `jobName`) and RETAIN policy
    - Create `test/stateless-stack.test.ts`
    - Assert IAM policies grant scoped access to S3, DynamoDB, Textract, Bedrock
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 9. Update configuration
  - Add Bedrock model ID config key to `src/config/config.ts` via convict (env: `HEIRLOOM_BEDROCK_MODEL_ID`, default to a sensible Claude model ARN)
  - Verify existing S3 and DynamoDB config keys are sufficient for all adapters
  - _Requirements: 9.5_

- [ ] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each architectural layer
- Property tests validate the 7 correctness properties defined in the design document
- Unit tests validate specific examples, edge cases, and error conditions
- The domain layer (tasks 1–2) has zero AWS SDK dependencies — all external calls go through port interfaces
- Outbound adapters (task 4) are the only layer that imports AWS SDK clients
