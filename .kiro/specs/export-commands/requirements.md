# Requirements Document

## Introduction

The export-commands feature replaces the current stub `export` CLI command with two concrete output formats: a print-ready PDF cookbook and an interlinked Obsidian vault. Both formats are derived from the canonical recipe data stored in DynamoDB and are fully rebuildable at any time. The feature follows the existing hexagonal architecture, introducing a domain-level export service that delegates rendering to outbound adapter ports for PDF generation and Markdown file writing.

## Glossary

- **Export_Service**: The domain service that orchestrates reading recipes from the DataStore and delegating to a rendering port to produce output files.
- **PDF_Renderer**: The outbound adapter that converts a collection of Recipe objects into a single print-ready PDF file.
- **Vault_Writer**: The outbound adapter that converts a collection of Recipe objects into a directory of interlinked Markdown files following Obsidian conventions.
- **Recipe**: A structured domain object containing a title, ingredients, instructions, notes, source, image keys, and confidence scores, identified by jobName and recipeNumber.
- **Job**: A named processing unit that groups a set of related recipes, identified by a kebab-case name and tracked by status.
- **Confidence_Score**: A numeric value between 0 and 1 indicating the extraction confidence for a specific recipe field (title, ingredients, instructions, notes).
- **Obsidian_Vault**: A directory of Markdown files using `[[wikilink]]` syntax for internal cross-references, compatible with the Obsidian knowledge base application.
- **Export_Handler**: The inbound CLI adapter that parses command-line arguments and invokes the Export_Service.
- **DataStore**: The port interface for reading and writing recipe and job data (implemented by DynamoDB in production).
- **FileSystemPort**: The port interface for local file system operations such as creating directories and writing files.

## Requirements

### Requirement 1: CLI Argument Parsing

**User Story:** As a user, I want to specify the export format and target job from the command line, so that I can generate the output I need for a specific job.

#### Acceptance Criteria

1. WHEN the user invokes `export pdf`, THE Export_Handler SHALL invoke the Export_Service with the format set to `pdf` and the currently active Job name.
2. WHEN the user invokes `export obsidian`, THE Export_Handler SHALL invoke the Export_Service with the format set to `obsidian` and the currently active Job name.
3. WHEN the user invokes `export` with no format argument, THE Export_Handler SHALL print a usage message listing the available formats (`pdf`, `obsidian`) and exit without performing an export.
4. WHEN the user invokes `export` with an unrecognized format argument, THE Export_Handler SHALL print an error message identifying the invalid format and listing the valid options, then exit with a non-zero exit code.
5. WHEN the user provides an optional `--job <name>` flag, THE Export_Handler SHALL use the specified Job name instead of the currently active Job.

### Requirement 2: Recipe Retrieval for Export

**User Story:** As a user, I want the export to pull all recipes for my job from the datastore, so that the output contains every transcribed recipe.

#### Acceptance Criteria

1. WHEN an export is requested for a Job, THE Export_Service SHALL retrieve all Recipe objects associated with that Job name from the DataStore.
2. IF the DataStore returns zero Recipe objects for the specified Job, THEN THE Export_Service SHALL report an error indicating that no recipes were found for the Job and abort the export.
3. THE Export_Service SHALL sort the retrieved Recipe objects by recipeNumber in ascending lexicographic order before passing them to the rendering port.

### Requirement 3: PDF Export

**User Story:** As a user, I want to generate a print-ready PDF cookbook from my transcribed recipes, so that I can print or share a physical copy.

#### Acceptance Criteria

1. WHEN the format is `pdf`, THE Export_Service SHALL invoke the PDF_Renderer with the sorted list of Recipe objects and an output file path.
2. THE PDF_Renderer SHALL produce a single PDF file at the specified output path.
3. THE PDF_Renderer SHALL render each Recipe on a separate section containing the title, source, ingredients list, instructions list, and notes.
4. THE PDF_Renderer SHALL include the recipeNumber for each Recipe in the rendered section.
5. THE PDF_Renderer SHALL include a table of contents at the beginning of the PDF listing each Recipe title and its corresponding recipeNumber.
6. WHEN a Recipe has any Confidence_Score below 0.7, THE PDF_Renderer SHALL display a review marker next to each field whose Confidence_Score is below 0.7.
7. THE PDF_Renderer SHALL include the S3 image key references for each Recipe so that the source photos are traceable.
8. THE Export_Handler SHALL write the PDF file to `./exports/<jobName>/<jobName>.pdf`, creating the directory if it does not exist.

### Requirement 4: Obsidian Vault Export

**User Story:** As a user, I want to generate an Obsidian vault from my transcribed recipes, so that I can browse, search, and interlink my recipes in a knowledge base.

#### Acceptance Criteria

1. WHEN the format is `obsidian`, THE Export_Service SHALL invoke the Vault_Writer with the sorted list of Recipe objects and an output directory path.
2. THE Vault_Writer SHALL create one Markdown file per Recipe, named `<recipeNumber>-<slugified-title>.md`, inside the output directory.
3. THE Vault_Writer SHALL include in each Markdown file the recipe title as a level-1 heading, followed by sections for source, ingredients, instructions, and notes.
4. THE Vault_Writer SHALL include the recipeNumber in the YAML frontmatter of each Markdown file.
5. WHEN a Recipe has a non-empty source field, THE Vault_Writer SHALL add a `[[source:<source>]]` wikilink in the Markdown file so that recipes from the same source collection are interlinked.
6. WHEN a Recipe has any Confidence_Score below 0.7, THE Vault_Writer SHALL add a `needs-review` tag in the YAML frontmatter and annotate each low-confidence field with an inline comment.
7. THE Vault_Writer SHALL include the S3 image key references in the frontmatter of each Markdown file so that the source photos are traceable.
8. THE Vault_Writer SHALL create an index file named `_index.md` in the output directory listing all recipes with wikilinks to their individual files.
9. THE Export_Handler SHALL write the vault files to `./exports/<jobName>/vault/`, creating the directory if it does not exist.

### Requirement 5: Export Service Port Abstraction

**User Story:** As a developer, I want the export rendering logic behind a port interface, so that the domain layer remains independent of PDF libraries and file format details.

#### Acceptance Criteria

1. THE Export_Service SHALL depend only on port interfaces and domain models, with zero direct dependencies on PDF libraries or file system implementations.
2. THE Export_Service SHALL accept a rendering port at construction time via dependency injection.
3. WHEN a new export format is added in the future, THE Export_Service SHALL require only a new port implementation without changes to the domain service logic.

### Requirement 6: Idempotent Export

**User Story:** As a user, I want to re-run the export command without creating duplicate or corrupted output, so that I can regenerate outputs after editing recipes.

#### Acceptance Criteria

1. WHEN the output file or directory already exists from a previous export, THE Export_Service SHALL overwrite the previous output completely rather than appending to it.
2. WHEN the export completes successfully, THE Export_Handler SHALL print a summary message including the number of recipes exported and the output path.
3. IF an error occurs during rendering, THEN THE Export_Service SHALL report the error and leave any partial output in place for debugging.

### Requirement 7: Job Status Validation

**User Story:** As a user, I want the export command to warn me if I try to export a job that has not been fully transcribed, so that I do not accidentally generate incomplete output.

#### Acceptance Criteria

1. WHEN an export is requested, THE Export_Service SHALL retrieve the Job status from the DataStore before proceeding.
2. IF the Job status is not `transcribed`, THEN THE Export_Service SHALL print a warning indicating the Job has not completed transcription, and proceed with the export using whatever recipes are available.
3. IF the Job does not exist in the DataStore, THEN THE Export_Service SHALL report an error indicating the Job was not found and abort the export.

### Requirement 8: Markdown Rendering for Obsidian

**User Story:** As a developer, I want a pure-function Markdown renderer that converts a Recipe into a Markdown string, so that the rendering logic is testable without file system access.

#### Acceptance Criteria

1. THE Vault_Writer SHALL use a pure function that accepts a Recipe and returns a complete Markdown string, including YAML frontmatter and body content.
2. THE Vault_Writer SHALL use a pure function that accepts a list of Recipe objects and returns the index Markdown string.
3. FOR ALL valid Recipe objects, rendering to Markdown then parsing the YAML frontmatter SHALL produce an object containing the original recipeNumber, jobName, and imageKeys (round-trip property).
4. THE Markdown rendering function SHALL preserve the original text of ingredients, instructions, and notes without normalization or reformatting.

### Requirement 9: Filename Slugification

**User Story:** As a developer, I want recipe titles to be converted to safe filenames, so that the Obsidian vault works across operating systems.

#### Acceptance Criteria

1. THE Vault_Writer SHALL convert Recipe titles to filename-safe slugs by lowercasing, replacing spaces and non-alphanumeric characters with hyphens, and collapsing consecutive hyphens.
2. THE Vault_Writer SHALL truncate slugified titles to a maximum of 100 characters to avoid file system path length limits.
3. FOR ALL non-empty title strings, THE slugification function SHALL produce a non-empty string containing only lowercase alphanumeric characters and hyphens (round-trip property: non-empty input produces non-empty valid output).
