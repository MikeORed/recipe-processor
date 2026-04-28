# Requirements Document

## Introduction

This spec covers the full implementation of four local-filesystem CLI commands — `init`, `jobs`, `use`, and `ingest` — replacing their current stub handlers with working logic. The work includes creating domain models (Job, ManifestEntry), domain ports (FileSystemPort), domain services (JobService, IngestService), an outbound filesystem adapter, and wiring everything through the inbound CLI handlers. No AWS services are involved; all operations are purely local. After this spec is complete, a user can create job workspaces, list them, select an active job, and generate manifest CSVs from scanned images.

## Glossary

- **CLI**: The command-line interface entry point at `bin/heirloom.ts`, invoked via `npx tsx bin/heirloom.ts`
- **Command_Handler**: A function in `src/adapters/inbound/` matching the `CommandHandler` type signature `(args: string[]) => Promise<void>`
- **Job**: A named workspace under the `jobs/` directory representing a batch of recipe images to process
- **Job_Directory**: The filesystem directory `jobs/<job-name>/` containing an `images/` subdirectory and optionally a `manifest.csv`
- **Active_Job**: The currently selected Job, persisted as a `.active-job` file in the `jobs/` directory containing the job name
- **Manifest**: A CSV file (`manifest.csv`) inside a Job_Directory listing discovered image files with columns for user annotation
- **Manifest_Entry**: A single row in the Manifest representing one discovered image file, with columns for grouping images into recipes and attributing their source collection
- **Image_File**: A file in `jobs/<job-name>/images/` with a supported extension (`.jpg`, `.jpeg`, `.png`, `.tiff`, `.tif`, `.bmp`, `.webp`)
- **Job_Status**: The current state of a Job, derived from filesystem contents: `initialized` (images/ exists, no manifest), `ingested` (manifest.csv exists), or `empty` (no images in images/)
- **FileSystem_Port**: A domain port interface defining filesystem operations needed by domain services
- **FileSystem_Adapter**: An outbound adapter implementing the FileSystem_Port using Node.js `fs` APIs
- **Job_Service**: A domain service orchestrating job creation, listing, and active-job selection
- **Ingest_Service**: A domain service orchestrating image discovery and manifest generation
- **Job_Name**: A non-empty string matching the pattern `^[a-z0-9][a-z0-9_-]*$` (lowercase alphanumeric, hyphens, underscores; must start with alphanumeric)

## Requirements

### Requirement 1: Job Name Validation

**User Story:** As a user, I want job names to be validated consistently, so that job directories have predictable, filesystem-safe names.

#### Acceptance Criteria

1. THE Job_Service SHALL accept Job_Name values that match the pattern `^[a-z0-9][a-z0-9_-]*$` and are between 1 and 128 characters long
2. WHEN a Job_Name contains uppercase letters, spaces, special characters, or starts with a hyphen or underscore, THEN THE Job_Service SHALL reject the name with a descriptive error message
3. WHEN a Job_Name is an empty string, THEN THE Job_Service SHALL reject the name with a descriptive error message
4. WHEN a Job_Name exceeds 128 characters, THEN THE Job_Service SHALL reject the name with a descriptive error message

### Requirement 2: Init Command — Create Job Workspace

**User Story:** As a user, I want to create a new job workspace with `heirloom init <job-name>`, so that I have a directory structure ready to receive recipe photos.

#### Acceptance Criteria

1. WHEN a user runs `heirloom init <job-name>` with a valid Job_Name, THE Init_Handler SHALL create the Job_Directory at `jobs/<job-name>/` with an `images/` subdirectory inside it
2. WHEN a user runs `heirloom init <job-name>` and the Job_Directory already exists, THEN THE Init_Handler SHALL report an error indicating the job already exists and exit with a non-zero exit code
3. WHEN a user runs `heirloom init` without providing a job name argument, THEN THE Init_Handler SHALL report an error indicating a job name is required and exit with a non-zero exit code
4. WHEN a job is successfully created, THE Init_Handler SHALL print a confirmation message including the job name and the path to the images directory
5. THE Init_Handler SHALL delegate directory creation to the FileSystem_Port, keeping the domain layer free of direct filesystem calls

### Requirement 3: Jobs Command — List Job Workspaces

**User Story:** As a user, I want to list all existing jobs with `heirloom jobs`, so that I can see what workspaces are available and their current status.

#### Acceptance Criteria

1. WHEN a user runs `heirloom jobs`, THE Jobs_Handler SHALL list all Job_Directories found under `jobs/`, displaying each job name and its Job_Status
2. WHEN no Job_Directories exist under `jobs/`, THE Jobs_Handler SHALL print a message indicating no jobs have been created
3. WHEN the `jobs/` directory does not exist, THE Jobs_Handler SHALL print a message indicating no jobs have been created
4. THE Jobs_Handler SHALL derive Job_Status from filesystem contents: `initialized` when `images/` exists but no `manifest.csv` is present, `ingested` when `manifest.csv` exists
5. WHEN an active job is set, THE Jobs_Handler SHALL visually indicate which job is the active one in the listing

### Requirement 4: Use Command — Select Active Job

**User Story:** As a user, I want to select a job as active with `heirloom use <job-name>`, so that subsequent commands like `ingest` operate on the correct job without requiring the name each time.

#### Acceptance Criteria

1. WHEN a user runs `heirloom use <job-name>` and the Job_Directory exists, THE Use_Handler SHALL persist the job name as the Active_Job by writing it to a `.active-job` file in the `jobs/` directory
2. WHEN a user runs `heirloom use <job-name>` and the Job_Directory does not exist, THEN THE Use_Handler SHALL report an error indicating the job was not found and exit with a non-zero exit code
3. WHEN a user runs `heirloom use` without providing a job name argument, THEN THE Use_Handler SHALL report an error indicating a job name is required and exit with a non-zero exit code
4. WHEN a job is successfully selected, THE Use_Handler SHALL print a confirmation message including the selected job name
5. WHEN a user runs `heirloom use <job-name>`, THE Use_Handler SHALL overwrite any previously set Active_Job

### Requirement 5: Ingest Command — Discover Images and Generate Manifest

**User Story:** As a user, I want to scan a job's images directory and generate a manifest CSV with `heirloom ingest`, so that I have a structured list of images to annotate before transcription.

#### Acceptance Criteria

1. WHEN a user runs `heirloom ingest` with an Active_Job set, THE Ingest_Handler SHALL scan the Active_Job's `images/` directory for Image_Files
2. WHEN Image_Files are discovered, THE Ingest_Handler SHALL generate a `manifest.csv` file in the Job_Directory with columns: `file`, `modified`, `recipe_number`, `source`
3. THE Manifest SHALL include one Manifest_Entry row per discovered Image_File, with the `file` column set to the filename, the `modified` column set to the file's last-modified ISO 8601 timestamp, and the `recipe_number` and `source` columns empty for user annotation
4. WHEN no Active_Job is set, THEN THE Ingest_Handler SHALL report an error indicating no active job is selected and suggest running `heirloom use <job-name>` first
5. WHEN the Active_Job's `images/` directory contains no Image_Files, THEN THE Ingest_Handler SHALL report an error indicating no images were found in the images directory
6. THE Manifest SHALL include a header row as the first line of the CSV
7. WHEN `heirloom ingest` is run again on a job that already has a `manifest.csv`, THE Ingest_Handler SHALL merge new Image_Files into the existing Manifest without duplicating entries for images already listed, and SHALL preserve user annotations (`recipe_number`, `source`) on existing rows while updating the `modified` timestamp
8. THE Manifest SHALL sort entries by file modified date in ascending order

### Requirement 6: Manifest CSV Format

**User Story:** As a user, I want the manifest CSV to follow a consistent format, so that I can edit it in any spreadsheet tool and the system can reliably parse it back.

#### Acceptance Criteria

1. THE Ingest_Service SHALL write the Manifest CSV with comma-separated values and a header row containing: `file,modified,recipe_number,source`
2. THE Ingest_Service SHALL quote field values that contain commas, double quotes, or newlines using RFC 4180 quoting rules
3. THE Ingest_Service SHALL produce a Manifest that, when parsed back, yields the same Manifest_Entry data (round-trip property)
4. THE Ingest_Service SHALL format the Manifest with one Manifest_Entry per line, using LF line endings

### Requirement 7: FileSystem Port and Adapter

**User Story:** As a developer, I want filesystem operations abstracted behind a port interface, so that domain services remain testable without touching the real filesystem.

#### Acceptance Criteria

1. THE FileSystem_Port SHALL define methods for: creating directories, checking if a path exists, getting a file's last-modified time, listing directory contents, reading file contents, and writing file contents
2. THE FileSystem_Adapter SHALL implement the FileSystem_Port using Node.js `fs/promises` APIs
3. THE FileSystem_Adapter SHALL create parent directories recursively when creating directories
4. THE domain services SHALL depend only on the FileSystem_Port interface, with no direct imports of Node.js `fs` modules

### Requirement 8: Domain Models

**User Story:** As a developer, I want Zod-validated domain models for Job and ManifestEntry, so that data flowing through the system is validated at boundaries.

#### Acceptance Criteria

1. THE domain layer SHALL define a `jobNameSchema` using Zod that validates the Job_Name pattern `^[a-z0-9][a-z0-9_-]*$` with a maximum length of 128 characters
2. THE domain layer SHALL define a `jobSchema` using Zod with fields: `name` (Job_Name), `status` (Job_Status enum), and `isActive` (boolean)
3. THE domain layer SHALL define a `manifestEntrySchema` using Zod with fields: `file` (non-empty string), `modified` (ISO 8601 date-time string), `recipeNumber` (string, default empty), and `source` (string, default empty)
4. THE domain layer SHALL export TypeScript types inferred from the Zod schemas

### Requirement 9: Error Handling

**User Story:** As a user, I want clear error messages when commands fail, so that I can understand what went wrong and how to fix it.

#### Acceptance Criteria

1. WHEN a command fails due to invalid input, THE Command_Handler SHALL print a descriptive error message to stderr and set a non-zero exit code
2. WHEN a command fails due to a filesystem error, THE Command_Handler SHALL wrap the underlying error in a HeirloomError with a user-friendly message
3. IF an unexpected error occurs during command execution, THEN THE CLI SHALL print the error message to stderr and set a non-zero exit code without exposing stack traces to the user
