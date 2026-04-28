# Implementation Plan: Export Commands

## Overview

Replace the stub `export` handler with two concrete export formats (PDF cookbook and Obsidian vault) following the existing hexagonal architecture. Implementation proceeds bottom-up: domain ports → pure functions → domain service → outbound adapters → inbound adapter, ensuring each layer is testable before wiring together.

## Tasks

- [ ] 1. Install dependencies and define domain ports
  - [ ] 1.1 Install `pdfkit` as a production dependency and `@types/pdfkit` + `yaml` as dev dependencies
    - Run `npm install pdfkit` and `npm install --save-dev @types/pdfkit yaml`
    - _Requirements: 3.1, 5.1_

  - [ ] 1.2 Create `PdfRendererPort` interface
    - Create `src/domain/ports/pdf-renderer-port.ts`
    - Define `PdfRendererPort` with method `render(recipes: Recipe[], outputPath: string): Promise<void>`
    - _Requirements: 5.1, 5.2_

  - [ ] 1.3 Create `MarkdownRendererPort` interface
    - Create `src/domain/ports/markdown-renderer-port.ts`
    - Define `MarkdownRendererPort` with method `renderVault(recipes: Recipe[], outputDir: string): Promise<void>`
    - _Requirements: 5.1, 5.2_

  - [ ] 1.4 Update `src/domain/ports/index.ts` barrel export
    - Add exports for `PdfRendererPort` and `MarkdownRendererPort`
    - _Requirements: 5.1_

- [ ] 2. Implement pure Markdown utility functions
  - [ ] 2.1 Create `src/domain/services/markdown-utils.ts` with `slugify` function
    - Implement `slugify(title: string): string` — lowercase, replace non-alphanumeric with hyphens, collapse consecutive hyphens, truncate to 100 chars, ensure non-empty output
    - Implement `buildVaultFilename(recipeNumber: string, title: string): string` — returns `<recipeNumber>-<slugified-title>.md`
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 2.2 Write property test for `slugify` (Property 7)
    - Create `src/domain/services/markdown-utils.pbt.ts`
    - **Property 7: Slugification validity**
    - For any non-empty string, verify output contains only `[a-z0-9-]`, no consecutive hyphens, length ≤ 100, and is non-empty
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [ ] 2.3 Implement `renderRecipeMarkdown` function
    - Accepts a `Recipe` and returns a complete Markdown string
    - Generate YAML frontmatter with recipeNumber, jobName, imageKeys, and conditional `needs-review` tag
    - Render title as level-1 heading, source wikilink if non-empty, ingredients list, instructions list, notes section
    - Add inline comment annotations for fields with confidence < 0.7
    - _Requirements: 8.1, 8.3, 8.4, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 2.4 Write property test for frontmatter round-trip (Property 2)
    - **Property 2: Markdown frontmatter round-trip**
    - Generate random Recipe objects, render to Markdown, parse YAML frontmatter with `yaml` package, verify recipeNumber/jobName/imageKeys preserved
    - **Validates: Requirements 8.3, 4.4, 4.7**

  - [ ]* 2.5 Write property test for body content preservation (Property 3)
    - **Property 3: Markdown body content preservation and structure**
    - Generate random Recipe objects, verify title as level-1 heading, every ingredient, instruction, and notes string appears verbatim
    - **Validates: Requirements 4.3, 8.4**

  - [ ]* 2.6 Write property test for source wikilink (Property 4)
    - **Property 4: Source wikilink conditional presence**
    - Generate recipes with/without source, verify `[[source:<source>]]` presence/absence
    - **Validates: Requirements 4.5**

  - [ ]* 2.7 Write property test for low-confidence annotations (Property 5)
    - **Property 5: Low-confidence review annotations**
    - Generate recipes with varying confidence scores, verify `needs-review` tag and inline comments for fields < 0.7
    - **Validates: Requirements 4.6**

  - [ ] 2.8 Implement `renderIndexMarkdown` function
    - Accepts a list of Recipe objects and returns the index Markdown string
    - Include a wikilink to each recipe file using `buildVaultFilename`
    - _Requirements: 4.8, 8.2_

  - [ ]* 2.9 Write property test for index completeness (Property 6)
    - **Property 6: Index completeness**
    - Generate random recipe lists, verify all wikilinks present and count equals recipe count
    - **Validates: Requirements 4.8**

  - [ ]* 2.10 Write unit tests for `markdown-utils`
    - Create `src/domain/services/markdown-utils.unit.ts`
    - Test `slugify` edge cases (special characters, long strings, unicode)
    - Test `buildVaultFilename` format
    - Test `renderRecipeMarkdown` with specific examples (high/low confidence, empty/non-empty source)
    - Test `renderIndexMarkdown` with specific recipe lists
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3_

- [ ] 3. Implement ExportService domain service
  - [ ] 3.1 Create `src/domain/services/export-service.ts`
    - Define `ExportFormat` type (`'pdf' | 'obsidian'`)
    - Define `ExportResult` interface (`recipeCount`, `outputPath`, `warnings`)
    - Implement `ExportService` class with constructor accepting `DataStore`, `PdfRendererPort`, `MarkdownRendererPort`
    - Implement `export(jobName, format, outputPath)` method:
      - Retrieve job status; throw `HeirloomError` if job not found
      - Warn if status ≠ `transcribed`
      - Retrieve recipes; throw `HeirloomError` if zero recipes
      - Sort recipes by `recipeNumber` ascending (lexicographic)
      - Delegate to appropriate renderer based on format
      - Return `ExportResult`
    - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 6.1, 6.3, 7.1, 7.2, 7.3_

  - [ ]* 3.2 Write property test for recipe sorting invariant (Property 1)
    - Create `src/domain/services/export-service.pbt.ts`
    - **Property 1: Recipe sorting invariant**
    - Generate random recipe lists, verify ascending lexicographic order by recipeNumber after sort
    - **Validates: Requirements 2.3**

  - [ ]* 3.3 Write unit tests for ExportService
    - Create `src/domain/services/export-service.unit.ts`
    - Test: calls DataStore.getJobStatus before getRecipesByJob
    - Test: throws when job not found
    - Test: warns when job status ≠ transcribed
    - Test: throws when zero recipes returned
    - Test: sorts recipes by recipeNumber before passing to renderer
    - Test: delegates to correct renderer based on format
    - Test: returns ExportResult with correct count and path
    - Test: reports errors from renderer without cleanup
    - _Requirements: 2.1, 2.2, 2.3, 6.3, 7.1, 7.2, 7.3_

  - [ ] 3.4 Update `src/domain/services/index.ts` barrel export
    - Add exports for `ExportService`, `ExportFormat`, `ExportResult`
    - Add exports for markdown-utils functions (`renderRecipeMarkdown`, `renderIndexMarkdown`, `slugify`, `buildVaultFilename`)
    - _Requirements: 5.1_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement outbound adapters
  - [ ] 5.1 Create `PdfKitAdapter` at `src/adapters/outbound/pdfkit-adapter.ts`
    - Implement `PdfRendererPort` interface
    - Accept `FileSystemPort` in constructor for directory creation
    - Generate PDF using `pdfkit`:
      - Table of contents with recipe titles and recipeNumbers
      - Per-recipe sections with title, recipeNumber, source, ingredients, instructions, notes
      - Review markers (`⚠️`) for fields with confidence < 0.7
      - Image key references per recipe
    - Write PDF stream to output path
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 5.2 Write unit tests for `PdfKitAdapter`
    - Create `src/adapters/outbound/pdfkit-adapter.unit.ts`
    - Mock `FileSystemPort`; verify directory creation
    - Verify PDF generation completes without error for valid recipes
    - Verify table of contents includes all recipe titles
    - Verify review markers appear for low-confidence fields
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ] 5.3 Create `ObsidianVaultAdapter` at `src/adapters/outbound/obsidian-vault-adapter.ts`
    - Implement `MarkdownRendererPort` interface
    - Accept `FileSystemPort` in constructor
    - Use `renderRecipeMarkdown` and `renderIndexMarkdown` from markdown-utils
    - Use `buildVaultFilename` for file naming
    - Create output directory, write one `.md` file per recipe, write `_index.md`
    - Overwrite existing files on re-export (idempotent)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 6.1_

  - [ ]* 5.4 Write unit tests for `ObsidianVaultAdapter`
    - Create `src/adapters/outbound/obsidian-vault-adapter.unit.ts`
    - Mock `FileSystemPort`; verify correct directory creation
    - Verify one file per recipe with correct filename pattern
    - Verify `_index.md` is written
    - Verify overwrites on re-export
    - _Requirements: 4.1, 4.2, 4.8, 6.1_

  - [ ] 5.5 Update `src/adapters/outbound/index.ts` barrel export
    - Add exports for `PdfKitAdapter` and `ObsidianVaultAdapter`
    - _Requirements: 5.1_

- [ ] 6. Implement ExportHandler inbound adapter
  - [ ] 6.1 Replace stub in `src/adapters/inbound/export-handler.ts`
    - Parse CLI arguments: extract format (`pdf` | `obsidian`) and optional `--job <name>` flag
    - Print usage message when no format argument provided
    - Print error and set `process.exitCode = 1` for unrecognized format
    - Resolve job name: use `--job` flag if provided, otherwise get active job from `JobService`
    - Print error if no active job and no `--job` flag
    - Construct output path: `./exports/<jobName>/<jobName>.pdf` for PDF, `./exports/<jobName>/vault/` for Obsidian
    - Wire up adapters (`DynamoDBAdapter`, `PdfKitAdapter` or `ObsidianVaultAdapter`, `NodeFileSystemAdapter`)
    - Invoke `ExportService.export()`
    - Print summary on success (recipe count and output path)
    - Catch `HeirloomError` and print to stderr with non-zero exit code
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.8, 4.9, 6.2_

  - [ ]* 6.2 Write unit tests for `ExportHandler`
    - Replace existing stub test in `src/adapters/inbound/export-handler.unit.ts`
    - Test: parses `pdf` and `obsidian` format arguments correctly
    - Test: prints usage when no format given
    - Test: prints error for unrecognized format
    - Test: resolves `--job` flag override vs active job
    - Test: prints summary on success
    - Test: handles errors gracefully (HeirloomError → stderr + exit code)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.2_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript (as specified in the design document)
- `pdfkit` is a new production dependency; `@types/pdfkit` and `yaml` are dev dependencies
