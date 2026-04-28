# Requirements Document

## Introduction

The **transcribe** command is step 3 of the Heirloom core workflow. It takes an ingested job (images + annotated manifest) and produces structured recipe records by: uploading images to S3, running OCR via AWS Textract, extracting recipe structure via a Bedrock foundation model (0-shot, Zod-validated), and persisting results to DynamoDB. The command is designed to be batch-friendly, resumable, and idempotent — running it twice on the same job produces no duplicate work.

## Glossary

- **Transcribe_Handler**: The CLI command handler that wires adapters to the TranscribeService and invokes the transcription pipeline for the active job.
- **TranscribeService**: The domain orchestration service that coordinates image upload, OCR, structure extraction, and persistence for all manifest entries in a job.
- **OCRProvider**: A domain port interface for submitting images to an OCR engine and retrieving raw text results.
- **StructureExtractor**: A domain port interface for extracting structured recipe data from raw OCR text using a foundation model.
- **DataStore**: A domain port interface for persisting and retrieving recipe records and job status.
- **ObjectStore**: A domain port interface for uploading and managing image files in cloud storage.
- **S3Adapter**: An outbound adapter implementing the ObjectStore port using AWS S3.
- **TextractAdapter**: An outbound adapter implementing the OCRProvider port using AWS Textract async batch API.
- **BedrockAdapter**: An outbound adapter implementing the StructureExtractor port using AWS Bedrock Runtime with structured output.
- **DynamoDBAdapter**: An outbound adapter implementing the DataStore port using AWS DynamoDB.
- **Recipe**: A structured domain model representing a single transcribed recipe, including title, ingredients, instructions, source metadata, confidence scores, and a link to the source image.
- **ManifestEntry**: An existing domain model representing a row in the manifest CSV, mapping an image file to a recipe number and source collection.
- **Job**: An existing domain model representing a processing workspace with a name, status, and active flag.
- **Confidence_Score**: A numeric value (0.0–1.0) indicating the OCR or extraction engine's certainty about a piece of transcribed text.

## Requirements

### Requirement 1: Active Job Validation

**User Story:** As a user, I want the transcribe command to validate that an active job exists and is in the correct state, so that I receive clear feedback when prerequisites are not met.

#### Acceptance Criteria

1. WHEN the transcribe command is invoked and no active job is selected, THE Transcribe_Handler SHALL print an error message instructing the user to run `heirloom use <job-name>` and exit with a non-zero exit code.
2. WHEN the transcribe command is invoked and the active job status is not `ingested`, THE Transcribe_Handler SHALL print an error message indicating the job must be ingested first and exit with a non-zero exit code.
3. WHEN the transcribe command is invoked and the active job status is `ingested`, THE Transcribe_Handler SHALL proceed with the transcription pipeline.

### Requirement 2: Manifest Reading

**User Story:** As a user, I want the transcribe command to read my annotated manifest, so that the pipeline knows which images belong to which recipe and their source collection.

#### Acceptance Criteria

1. WHEN the transcription pipeline starts, THE TranscribeService SHALL read the manifest CSV from the active job directory.
2. WHEN the manifest CSV contains entries with empty `recipeNumber` fields, THE TranscribeService SHALL skip those entries and report the count of skipped entries.
3. WHEN the manifest CSV contains no entries with a non-empty `recipeNumber`, THE TranscribeService SHALL return an error indicating no annotated entries were found.
4. THE TranscribeService SHALL group manifest entries by `recipeNumber` to associate multiple images with a single recipe.

### Requirement 3: Image Upload to S3

**User Story:** As a user, I want my recipe images uploaded to cloud storage, so that downstream AWS services can access them for processing.

#### Acceptance Criteria

1. WHEN processing a manifest entry, THE TranscribeService SHALL upload the image file to the ObjectStore under the key pattern `<job-name>/<image-filename>`.
2. IF an image file referenced in the manifest does not exist on the local filesystem, THEN THE TranscribeService SHALL report the missing file and skip that entry.
3. WHEN an image has already been uploaded to the ObjectStore with the same key, THE TranscribeService SHALL skip the upload for that image.

### Requirement 4: OCR via Textract

**User Story:** As a user, I want OCR performed on my recipe images, so that handwritten and printed text is extracted for further processing.

#### Acceptance Criteria

1. WHEN an image has been uploaded to the ObjectStore, THE TranscribeService SHALL submit the image to the OCRProvider for text extraction.
2. THE OCRProvider SHALL support extraction of both handwritten and printed text.
3. WHEN the OCRProvider returns results, THE TranscribeService SHALL receive raw text blocks with per-block confidence scores.
4. IF the OCRProvider returns an error for a specific image, THEN THE TranscribeService SHALL log the error, skip that image, and continue processing remaining images.

### Requirement 5: Structure Extraction via Bedrock FM

**User Story:** As a user, I want raw OCR text converted into structured recipe data, so that recipes are organized into searchable fields while preserving the original language.

#### Acceptance Criteria

1. WHEN OCR text is available for all images in a recipe group, THE TranscribeService SHALL submit the combined OCR text to the StructureExtractor along with the source metadata.
2. THE StructureExtractor SHALL extract structured fields including title, ingredients, instructions, and notes from the raw OCR text using a 0-shot prompt.
3. THE StructureExtractor SHALL return a result that conforms to the Recipe schema validated by Zod.
4. THE StructureExtractor SHALL preserve the original language and phrasing of the source text without normalization.
5. THE StructureExtractor SHALL include a confidence score (0.0–1.0) for each extracted field.
6. IF the StructureExtractor returns a result that fails Zod validation, THEN THE TranscribeService SHALL log the validation error, skip that recipe group, and continue processing remaining groups.

### Requirement 6: Recipe Persistence to DynamoDB

**User Story:** As a user, I want transcribed recipes stored in a durable datastore, so that they are available for export and review.

#### Acceptance Criteria

1. WHEN a recipe has been successfully extracted and validated, THE TranscribeService SHALL persist the Recipe record to the DataStore.
2. THE Recipe record SHALL include a reference to the source image key(s) in the ObjectStore.
3. THE Recipe record SHALL include the job name, recipe number, and source collection from the manifest.
4. WHEN a Recipe record with the same job name and recipe number already exists in the DataStore, THE TranscribeService SHALL overwrite the existing record with the new transcription.

### Requirement 7: Job Status Progression

**User Story:** As a user, I want the job status to reflect transcription progress, so that I can track which jobs have been processed.

#### Acceptance Criteria

1. WHEN the transcription pipeline begins, THE TranscribeService SHALL update the job status to `transcribing`.
2. WHEN the transcription pipeline completes successfully for all processable entries, THE TranscribeService SHALL update the job status to `transcribed`.
3. WHEN the transcription pipeline completes with some entries skipped due to errors, THE TranscribeService SHALL still update the job status to `transcribed` and report the count of skipped entries.
4. IF the transcription pipeline fails entirely before processing any entries, THEN THE TranscribeService SHALL revert the job status to `ingested`.

### Requirement 8: Domain Port Interfaces

**User Story:** As a developer, I want transcription dependencies defined as domain port interfaces, so that adapters are swappable without modifying domain logic.

#### Acceptance Criteria

1. THE ObjectStore port SHALL define methods for uploading a file and checking whether a key exists.
2. THE OCRProvider port SHALL define methods for submitting an image for OCR and retrieving text results with confidence scores.
3. THE StructureExtractor port SHALL define a method for extracting structured recipe data from raw OCR text.
4. THE DataStore port SHALL define methods for persisting a Recipe record and retrieving Recipe records by job name.

### Requirement 9: Outbound Adapter Implementations

**User Story:** As a developer, I want concrete AWS adapter implementations for each domain port, so that the transcription pipeline connects to real cloud services.

#### Acceptance Criteria

1. THE S3Adapter SHALL implement the ObjectStore port using the `@aws-sdk/client-s3` library.
2. THE TextractAdapter SHALL implement the OCRProvider port using the `@aws-sdk/client-textract` library with async document analysis for handwriting and printed text.
3. THE BedrockAdapter SHALL implement the StructureExtractor port using the `@aws-sdk/client-bedrock-runtime` library with structured output (0-shot prompt, Zod-validated response).
4. THE DynamoDBAdapter SHALL implement the DataStore port using the `@aws-sdk/lib-dynamodb` library.
5. THE S3Adapter, TextractAdapter, BedrockAdapter, and DynamoDBAdapter SHALL read configuration values (region, bucket name, table names) from the convict config module.

### Requirement 10: Recipe Domain Model

**User Story:** As a developer, I want a well-defined Recipe domain model, so that structured recipe data is consistently validated throughout the pipeline.

#### Acceptance Criteria

1. THE Recipe model SHALL include fields for: title, ingredients (list), instructions (list), notes, source image key(s), job name, recipe number, source collection, and per-field confidence scores.
2. THE Recipe model SHALL be defined as a Zod schema with the `recipeSchema` naming convention.
3. THE Recipe model SHALL validate that confidence scores are numbers between 0.0 and 1.0 inclusive.
4. FOR ALL valid Recipe objects, serializing to JSON then parsing back through the recipeSchema SHALL produce an equivalent object (round-trip property).

### Requirement 11: CDK Infrastructure

**User Story:** As a developer, I want the required AWS infrastructure provisioned via CDK, so that the transcription pipeline has the cloud resources it needs.

#### Acceptance Criteria

1. THE StatefulStack SHALL provision an S3 bucket for image storage with a configurable bucket name.
2. THE StatefulStack SHALL provision a DynamoDB table for recipe records with partition key `jobName` and sort key `recipeNumber`.
3. THE StatefulStack SHALL provision a DynamoDB table for job tracking with partition key `jobName`.
4. THE StatefulStack SHALL apply a RETAIN removal policy to the S3 bucket and DynamoDB tables.
5. THE StatelessStack SHALL provision IAM policies granting scoped access to S3, DynamoDB, Textract, and Bedrock services.

### Requirement 12: CLI Output and Progress Reporting

**User Story:** As a user, I want clear progress feedback during transcription, so that I know what the pipeline is doing and what the results are.

#### Acceptance Criteria

1. WHEN the transcription pipeline starts, THE Transcribe_Handler SHALL print the job name and the number of recipe groups to process.
2. WHILE processing each recipe group, THE Transcribe_Handler SHALL print progress indicating the current recipe group being processed.
3. WHEN the transcription pipeline completes, THE Transcribe_Handler SHALL print a summary including the count of recipes successfully transcribed, the count of entries skipped, and the total processing time.
4. IF an error occurs during processing of a specific entry, THEN THE Transcribe_Handler SHALL print a warning message identifying the entry and the error, and continue processing.

### Requirement 13: Idempotent and Resumable Processing

**User Story:** As a user, I want to re-run the transcribe command safely, so that interrupted or partially completed jobs can be resumed without reprocessing already-completed work.

#### Acceptance Criteria

1. WHEN the transcribe command is invoked on a job with status `transcribed`, THE TranscribeService SHALL re-process all annotated manifest entries, overwriting existing records.
2. WHEN an image already exists in the ObjectStore with the same key, THE TranscribeService SHALL skip the upload step for that image.
3. THE TranscribeService SHALL process each recipe group independently so that a failure in one group does not prevent processing of other groups.
