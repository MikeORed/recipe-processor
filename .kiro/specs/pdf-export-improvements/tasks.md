# Implementation Plan: PDF Export Improvements

## Overview

This plan transforms the Heirloom PDF export pipeline from a flat, unstructured single-pass renderer into a professional cookbook generator with chapter grouping, table of contents with page numbers, multi-recipe page layouts, image embedding, and full CLI control. Implementation follows the existing hexagonal architecture, modifying domain models, ports, services, and adapters incrementally.

## Tasks

- [x] 1. Extend Recipe schema and PdfRendererPort interface
  - [x] 1.1 Add `category` and `cuisine` enums and fields to `recipeSchema` in `src/domain/models/recipe.ts`
    - Define `categoryEnum` with the 15-item enum (14 canonical + "uncategorized")
    - Define `cuisineEnum` with the 15-item enum
    - Add `category` as required field constrained to `categoryEnum`
    - Add `cuisine` as nullable field constrained to `cuisineEnum`
    - Retain existing `tags` array unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Write property test for schema enum validation (Property 1)
    - **Property 1: Schema enum validation (category and cuisine)**
    - Test that `recipeSchema` accepts valid category values and rejects invalid ones
    - Test that `recipeSchema` accepts valid cuisine values, null, and rejects invalid ones
    - File: `src/domain/models/recipe.pbt.ts` (extend existing)
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5**

  - [x] 1.3 Update `PdfRendererPort` interface in `src/domain/ports/pdf-renderer-port.ts`
    - Define `ImageMode`, `PageSize` types
    - Define `PdfRenderOptions` interface with `imageMode`, `pageSize`, `multiPerPage`, `confidenceMarkers`, `chapterGrouping`
    - Define `ChapterGroup` interface with `chapter` (string) and `recipes` (Recipe[])
    - Update `render()` signature to accept `(chapters: ChapterGroup[], options: PdfRenderOptions, outputPath: string)`
    - _Requirements: 15.1, 15.2_

  - [x] 1.4 Update `DataStore` port in `src/domain/ports/data-store-port.ts`
    - Add `getRecipeWithOcr(jobName: string, recipeNumber: string)` or equivalent method needed by BackfillService to retrieve persisted OCR text
    - Add `putRecipe` already exists — verify it handles the new `category`/`cuisine` fields
    - _Requirements: 3.1, 3.2_

- [x] 2. Augment BedrockAdapter extraction prompt
  - [x] 2.1 Update `buildPrompt()` and JSON schema in `src/adapters/outbound/bedrock-adapter.ts`
    - Add `category` field to `RECIPE_OBJECT_SCHEMA` constrained to 14-item canonical enum (exclude "uncategorized"), required, non-nullable
    - Add `cuisine` field constrained to 15-item cuisine enum, nullable
    - Add classification heuristic text to prompt body with the precedence chain: type exceptions → primary protein → dish structure → fallback
    - Add at least 3 few-shot disambiguation examples with rationale
    - Update response validation to use updated `recipeSchema` (which now requires category/cuisine)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.2 Write property test for FM response validation (Property 2)
    - **Property 2: FM response category/cuisine validation**
    - Generate arbitrary invalid category/cuisine values and verify the adapter rejects them
    - File: `src/adapters/outbound/bedrock-adapter.pbt.ts`
    - **Validates: Requirements 2.5, 2.6**

- [x] 3. Implement BackfillService and BackfillHandler
  - [x] 3.1 Create `BackfillService` in `src/domain/services/backfill-service.ts`
    - Implement `backfill(jobName: string, concurrency: number): Promise<BackfillResult>`
    - Retrieve all recipes for the job from DynamoDB
    - Re-submit each recipe's persisted OCR text through BedrockAdapter with bounded concurrency (p-limit pattern)
    - On success: overwrite DynamoDB record preserving jobName, recipeNumber, source, imageKeys
    - On failure: patch with `category: "uncategorized"`, `cuisine: null`, log error, continue
    - Implement exponential backoff with jitter on ThrottlingException (max 3 retries)
    - Report `{ totalProcessed, successCount, failedCount, failures }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

  - [x] 3.2 Create `BackfillHandler` in `src/adapters/inbound/backfill-handler.ts`
    - Parse `heirloom backfill [--job <name>] [--concurrency <n>]`
    - Default concurrency: 5, validate positive integer
    - Resolve job name from active job if `--job` not provided
    - Wire up BackfillService with DynamoDBAdapter and BedrockAdapter
    - Print summary on completion
    - _Requirements: 3.5, 3.6_

  - [x] 3.3 Register `backfill` command in CLI router (`src/adapters/inbound/cli.ts`)
    - Add backfill command to the command dispatcher
    - _Requirements: 3.6_

  - [x] 3.4 Write unit tests for BackfillService
    - Test bounded concurrency behavior
    - Test error handling and partial failure continuation
    - Test retry logic on ThrottlingException
    - File: `src/domain/services/backfill-service.unit.ts`
    - _Requirements: 3.1, 3.4, 3.7_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement ExportService grouping, sorting, and image pre-processing
  - [x] 5.1 Update `ExportService` in `src/domain/services/export-service.ts`
    - Update `export()` method signature to accept `PdfRenderOptions`
    - Implement chapter grouping: group recipes by `category` in canonical order, map "uncategorized" → "Odds & Ends", omit empty chapters
    - Implement alphabetical sorting (case-insensitive) within each chapter group
    - When `chapterGrouping: false`, produce a single flat group sorted alphabetically
    - Construct `ChapterGroup[]` array and pass to `pdfRenderer.render(chapters, options, outputPath)`
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 14.3, 15.4_

  - [x] 5.2 Write property test for chapter grouping (Property 4)
    - **Property 4: Chapter grouping preserves canonical order and completeness**
    - Verify canonical order, no empty groups, every recipe in exactly one group, alphabetical within group
    - File: `src/domain/services/export-service.pbt.ts`
    - **Validates: Requirements 5.5, 5.7, 6.3, 6.4, 6.5**

  - [x] 5.3 Write property test for flat mode (Property 5)
    - **Property 5: Flat mode produces single alphabetically-sorted group**
    - Verify single group, all recipes present, alphabetically sorted
    - File: `src/domain/services/export-service.pbt.ts`
    - **Validates: Requirements 6.6, 14.3**

  - [x] 5.4 Write property test for source appendix grouping (Property 6)
    - **Property 6: Source appendix grouping and ordering**
    - Verify distinct source keys, alphabetical source ordering, alphabetical recipes within source, empty/blank → "Unknown Source"
    - File: `src/domain/services/export-service.pbt.ts`
    - **Validates: Requirements 7.2, 7.4, 7.5**

  - [x] 5.5 Create image pre-processing utility in `src/domain/services/image-processor.ts`
    - Implement `preprocessImages(imageKeys, jobName, targetWidthPx, targetDpi): Promise<ProcessedImage[]>`
    - Resolve imageKey → local path (`jobs/<jobName>/images/<filename>`)
    - Use `sharp` to resize to target width at 150 DPI, write to temp directory as JPEG
    - Return metadata (originalKey, localPath, widthPx, heightPx)
    - Handle missing files gracefully (skip, log warning)
    - _Requirements: 11.5, 11.7, 11.8_

  - [x] 5.6 Write property test for ImageKey path resolution (Property 11)
    - **Property 11: ImageKey path resolution**
    - Verify that any imageKey `"<jobName>/<filename>"` resolves to `"jobs/<jobName>/images/<filename>"`
    - File: `src/domain/services/export-service.pbt.ts`
    - **Validates: Requirements 11.5**

- [x] 6. Rewrite PdfKitAdapter — body rendering with chapter dividers and recipe formatting
  - [x] 6.1 Scaffold the new `PdfKitAdapter` structure in `src/adapters/outbound/pdfkit-adapter.ts`
    - Update class to implement the new `PdfRendererPort` signature
    - Add `render()` orchestrating Body_TOC_Merge pipeline
    - Add helper method stubs: `renderBody()`, `renderToc()`, `mergeDocuments()`, `renderChapterDivider()`, `renderRecipe()`, `renderSourceAppendix()`, `estimateRecipeHeight()`, `stampHeaders()`
    - Define page layout constants (letter/A4 dimensions, margins, content width/height)
    - Define typography scale constants
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 15.1, 15.2_

  - [x] 6.2 Implement `renderBody()` — chapter dividers and recipe pages
    - Render chapter divider pages (28pt Helvetica-Bold, centered horizontally and vertically)
    - Render recipe pages with: title (18pt bold), decorative rule under title, attribution line, source line, sections (Ingredients, Instructions, Notes)
    - Track page positions for each recipe during rendering (for TOC)
    - Track which recipe starts on each page (for headers)
    - Implement multi-per-page logic: measure remaining space vs estimated next recipe height + 24.5pt separator; if fits, render horizontal rule and continue; if not, new page
    - Enforce cross-chapter page isolation (no same-page recipes from different chapters)
    - _Requirements: 6.1, 6.2, 8.1, 8.2, 8.3, 8.4, 10.5, 10.6, 13.1, 13.2_

  - [x] 6.3 Implement attribution and source rendering in `renderRecipe()`
    - Format attribution: "By [author], [year]" | "By [author]" | "[year]" | none
    - Render in 10pt Times-Italic between title and source line
    - Handle long author names (natural wrap within margins)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 6.4 Write property test for attribution format (Property 3)
    - **Property 3: Attribution format correctness**
    - Generate arbitrary author/year combinations and verify format
    - File: `src/adapters/outbound/pdfkit-adapter.pbt.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [x] 6.5 Implement overflow pagination with continuation headers
    - Use `doc.heightOfString()` to measure each content block before rendering
    - If block exceeds remaining space, trigger manual page break
    - Render continuation header "[Recipe Title], continued" at top of new page
    - Skip continuation header if recipe fits on one page
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 6.6 Write property test for continuation header format (Property 9)
    - **Property 9: Continuation header format**
    - Verify any title string produces exactly "[title], continued"
    - File: `src/adapters/outbound/pdfkit-adapter.pbt.ts`
    - **Validates: Requirements 9.2**

  - [x] 6.7 Write property test for multi-per-page fit decision (Property 7)
    - **Property 7: Multi-per-page fit decision**
    - Verify that given remaining space R and height H, same-page iff R >= H + 24.5
    - File: `src/adapters/outbound/pdfkit-adapter.pbt.ts`
    - **Validates: Requirements 8.1, 8.2**

  - [x] 6.8 Write property test for cross-chapter page isolation (Property 8)
    - **Property 8: Cross-chapter page isolation**
    - Verify no page contains recipes from different chapters
    - File: `src/adapters/outbound/pdfkit-adapter.pbt.ts`
    - **Validates: Requirements 8.4**

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement TOC rendering, PDF merging, and source appendix
  - [x] 8.1 Implement `renderToc()` — table of contents with page numbers
    - Render TOC starting on page 1, max 40 entries per page
    - Group entries under chapter headings (flush-left), recipe titles indented 18pt
    - Truncate titles > 70 chars with ellipsis
    - Add dot leaders between title and page number
    - Offset all page numbers by TOC page count
    - Omit empty chapters, omit recipeNumber values
    - Skip TOC entirely if zero recipes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 8.2 Implement `mergeDocuments()` — pdf-lib merge of toc.pdf + body.pdf
    - Use `pdf-lib` to merge TOC pages before body pages into final output
    - Produce valid PDF with correct cross-reference tables
    - Clean up temporary files
    - _Requirements: 5.4_

  - [x] 8.3 Write property test for TOC page number offset (Property 10)
    - **Property 10: TOC page number offset**
    - Verify displayed page number = body position + N (TOC page count)
    - File: `src/adapters/outbound/pdfkit-adapter.pbt.ts`
    - **Validates: Requirements 5.3, 5.4**

  - [x] 8.4 Implement `renderSourceAppendix()` — compact source listing
    - Render after all recipe chapters in body
    - Group recipes by distinct source value, alphabetical by source name
    - Map empty/blank source → "Unknown Source"
    - Sort recipes alphabetically by title within each source group
    - Use compact layout: 9pt body text, 6pt spacing, 10pt bold source headings
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 8.5 Implement `stampHeaders()` — retroactive page headers and footers
    - Stamp chapter name (left) and recipe title (right) in 8pt font in top margin on recipe content pages
    - Truncate header elements > 50 chars with ellipsis to prevent overlap
    - Render centered page number in footer (8pt, 0.4 grayscale) on recipe content pages
    - Skip headers/footers on TOC and Chapter_Divider pages
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 10.4_

  - [x] 8.6 Write property test for header/footer page-type invariant (Property 12)
    - **Property 12: Header and footer page-type invariant**
    - Verify headers/footers appear only on recipe content pages, not TOC or divider pages
    - File: `src/adapters/outbound/pdfkit-adapter.pbt.ts`
    - **Validates: Requirements 10.4, 12.1, 12.2**

- [x] 9. Implement image embedding in PdfKitAdapter
  - [x] 9.1 Add image embedding logic to `renderRecipe()` in `src/adapters/outbound/pdfkit-adapter.ts`
    - In `thumbnail` mode: embed pre-processed images inline at max 300px width, preserving aspect ratio
    - In `full` mode: embed pre-processed images on separate page at max 975px width
    - In `none` mode: no image embedding, no image reference text
    - Handle multiple imageKeys per recipe (render in sequence)
    - Render placeholder "Source image not available" in 8pt gray italic if file missing
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_

  - [x] 9.2 Write unit tests for image embedding
    - Test thumbnail dimensions and aspect ratio preservation
    - Test full-page image rendering
    - Test placeholder rendering for missing files
    - Test multiple images per recipe
    - File: `src/adapters/outbound/pdfkit-adapter.unit.ts`
    - _Requirements: 11.1, 11.2, 11.6_

- [x] 10. Update ExportHandler with CLI options
  - [x] 10.1 Update `exportHandler` in `src/adapters/inbound/export-handler.ts`
    - Parse new flags: `--images` (none|thumbnail|full, default: thumbnail), `--page-size` (letter|a4, default: letter), `--multi-per-page` (boolean, default: true), `--confidence` (boolean, default: true), `--no-chapters` (boolean, default: false)
    - Construct `PdfRenderOptions` object from parsed flags with correct defaults
    - Reject unrecognized option values with error message listing valid values, exit code 1
    - Pass options to `ExportService.export()` (updated signature)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 15.3, 15.5_

  - [x] 10.2 Write property test for CLI option parsing (Property 13)
    - **Property 13: CLI option parsing with defaults and rejection**
    - Generate arbitrary valid flag combinations and verify correct PdfRenderOptions output
    - Generate invalid values for --images and --page-size and verify rejection
    - File: `src/adapters/inbound/export-handler.pbt.ts`
    - **Validates: Requirements 14.1, 14.2, 15.3, 15.5**

- [x] 11. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Integration wiring and final validation
  - [ ] 12.1 Wire updated ExportService to PdfKitAdapter in ExportHandler
    - Update adapter instantiation in ExportHandler to pass image-preprocessed data
    - Integrate image pre-processing step in ExportService before calling `pdfRenderer.render()`
    - Ensure `ExportService.export()` calls image processor when `imageMode !== 'none'`
    - Verify end-to-end flow: CLI → ExportHandler → ExportService (grouping + image prep) → PdfKitAdapter (Body_TOC_Merge)
    - _Requirements: 15.3, 15.4_

  - [ ] 12.2 Write integration test for full PDF render pipeline
    - Verify Body_TOC_Merge produces valid PDF with correct page count
    - Verify TOC page numbers match actual recipe positions
    - Verify chapter divider pages present for non-empty categories
    - Parse output PDF with pdf-lib to validate structure
    - File: `test/pdf-export.test.ts`
    - _Requirements: 5.4, 6.1, 8.1_

  - [ ] 12.3 Write integration test for backfill pipeline
    - Mock Bedrock responses, verify all recipes processed
    - Verify DynamoDB records updated with category/cuisine
    - Verify partial failure handling
    - File: `test/backfill.test.ts`
    - _Requirements: 3.1, 3.4, 3.5_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementations use TypeScript 5.9 strict mode
- pdfkit for PDF generation, pdf-lib for merging, sharp for image pre-processing, fast-check for PBT
- Existing `PdfKitAdapter` and `ExportService` are modified in-place (not new files)
- `BackfillService` and `BackfillHandler` are new files

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "5.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "5.5"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.6", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "6.5", "6.7", "6.8"] },
    { "id": 7, "tasks": ["6.6", "8.1", "8.4"] },
    { "id": 8, "tasks": ["8.2", "8.5"] },
    { "id": 9, "tasks": ["8.3", "8.6", "9.1"] },
    { "id": 10, "tasks": ["9.2", "10.1"] },
    { "id": 11, "tasks": ["10.2", "12.1"] },
    { "id": 12, "tasks": ["12.2", "12.3"] }
  ]
}
```
