# Requirements Document

## Introduction

This feature overhauls the PDF export pipeline for the Heirloom recipe processor CLI. The current implementation produces a flat, unstructured PDF with no page numbers, no chapter grouping, no image embedding, and limited typography. This revision introduces a canonical category system driven by FM extraction, chapter-based grouping with a table of contents, multi-recipe page layouts, image embedding, and CLI options for controlling output. Vault export improvements (Phase 4 in the revision plan) are explicitly out of scope.

## Glossary

- **Recipe_Schema**: The Zod-validated domain model representing a single extracted recipe, defined in `src/domain/models/recipe.ts`
- **Category**: A required single-select classification field constrained to the 15-item canonical enum (14 canonical categories plus "uncategorized"), used to assign recipes to PDF chapters
- **Cuisine**: A nullable single-select classification field identifying the cultural origin of a recipe, displayed per-recipe but not used for chapter grouping
- **ExportService**: The domain service responsible for retrieving recipes from the DataStore, grouping and sorting them, and delegating to the appropriate renderer
- **PdfKitAdapter**: The outbound adapter implementing `PdfRendererPort` using the pdfkit library to generate PDF output
- **BedrockAdapter**: The outbound adapter implementing `StructureExtractor` that invokes AWS Bedrock FM for structured recipe extraction from OCR text
- **PdfRendererPort**: The port interface defining the contract between the domain layer and the PDF rendering adapter
- **PdfRenderOptions**: A typed options object threaded through the port interface controlling PDF output behavior (image mode, page size, chapter grouping, confidence markers, multi-per-page layout)
- **TOC**: Table of Contents — the front-matter pages listing chapter headings and recipe titles with accurate page numbers
- **Chapter_Divider**: A full page rendered before each category's recipes displaying the category name as a visual separator
- **Backfill**: The process of re-running FM extraction on existing recipes using the updated prompt to populate category and cuisine fields
- **Dot_Leaders**: A row of dots connecting a TOC entry title to its page number for readability
- **Body_TOC_Merge**: A three-step PDF rendering strategy: (1) Render body.pdf — all chapter dividers and recipe pages — to a temporary file, collecting each recipe's page position during rendering. (2) Render toc.pdf — the Table of Contents — as a separate PDF file using the collected page numbers (offset by the TOC page count). (3) Merge toc.pdf + body.pdf into the final output PDF using `pdf-lib` (or equivalent PDF merge library) to produce a valid file with correct cross-reference tables.
- **Image_Downsampling**: Pre-processing source images with sharp to reduce resolution to target DPI before embedding, reducing memory usage and PDF file size

## Requirements

### Requirement 1: Recipe Schema Extension

**User Story:** As a developer, I want the Recipe domain model to include category and cuisine fields, so that recipes can be classified for chapter grouping and cultural attribution.

#### Acceptance Criteria

1. THE Recipe_Schema SHALL include a `category` field that is required and constrained to exactly one value from the 15-item enum: Appetizers & Snacks, Soups & Stews, Salads & Dressings, Beef & Pork, Poultry, Seafood, Pasta & Rice, Sides & Vegetables, Breads, Cakes, Pies & Pastries, Cookies & Bars, Beverages, Sauces & Condiments, uncategorized
2. THE Recipe_Schema SHALL include a `cuisine` field that is nullable and constrained to one value from the 15-item cuisine enum: American, American Regional, Mexican & Central American, South American, Caribbean, Italian, French, European & Eastern European, Mediterranean, Middle Eastern, African, South Asian, East Asian, Southeast Asian, Other, or null
3. THE Recipe_Schema SHALL retain the existing `tags` array field for freeform supplementary tags independent of the category classification
4. IF a recipe record is validated with a `category` value not present in the 15-item enum or with `category` absent, THEN THE Recipe_Schema SHALL reject the record with a validation error indicating the invalid or missing category value
5. IF a recipe record is validated with a `cuisine` value not present in the cuisine enum and not null, THEN THE Recipe_Schema SHALL reject the record with a validation error indicating the invalid cuisine value
6. THE "uncategorized" value in the category enum SHALL exist solely to represent legacy records that predate the category field addition and recipes where backfill extraction failed, which are patched with category: 'uncategorized' and cuisine: null (per Requirement 3 criterion 4). THE BedrockAdapter SHALL NEVER output "uncategorized" as a category value.

### Requirement 2: FM Extraction Prompt Augmentation

**User Story:** As a developer, I want the Bedrock extraction prompt to produce consistent category and cuisine assignments, so that recipes are automatically classified during transcription.

#### Acceptance Criteria

1. WHEN the BedrockAdapter builds the extraction prompt, THE BedrockAdapter SHALL include a `category` field definition constrained to the 14-item canonical enum (Appetizers & Snacks, Soups & Stews, Salads & Dressings, Beef & Pork, Poultry, Seafood, Pasta & Rice, Sides & Vegetables, Breads, Cakes, Pies & Pastries, Cookies & Bars, Beverages, Sauces & Condiments) in the JSON schema with the field marked as required and non-nullable
2. WHEN the BedrockAdapter builds the extraction prompt, THE BedrockAdapter SHALL include a `cuisine` field definition constrained to the 15-item cuisine enum (American, American Regional, Mexican & Central American, South American, Caribbean, Italian, French, European & Eastern European, Mediterranean, Middle Eastern, African, South Asian, East Asian, Southeast Asian, Other) in the JSON schema with the field marked as nullable
3. WHEN the BedrockAdapter builds the extraction prompt, THE BedrockAdapter SHALL include classification heuristics specifying the following precedence chain in this exact priority order: (1) Highest priority — Type exceptions: dips, spreads, and finger foods classify as Appetizers & Snacks; candy and frozen desserts classify as Cookies & Bars; gelatin salads and fruit salads classify as Salads & Dressings; these type exceptions ALWAYS override protein classification. (2) Second priority — Primary protein: if the recipe has a dominant protein (beef, pork, chicken, turkey, shrimp, fish), classify by that protein's chapter (Beef & Pork, Poultry, Seafood). (3) Third priority — Dish structure: classify by the dish form (soup → Soups & Stews, pasta/rice → Pasta & Rice, bread → Breads, beverage → Beverages, vegetable-forward → Sides & Vegetables). (4) Fallback: if ambiguous after all rules, prefer protein chapter over structural chapter.
4. WHEN the BedrockAdapter builds the extraction prompt, THE BedrockAdapter SHALL include at least three few-shot examples where each example provides an OCR text excerpt, the assigned category and cuisine values, and a one-sentence rationale referencing the specific precedence level applied (e.g., "chicken dip" → Appetizers & Snacks because the type exception for dips overrides the chicken protein)
5. WHEN the BedrockAdapter receives a valid response, THE BedrockAdapter SHALL validate the extracted `category` value against the canonical enum using the recipeSchema and SHALL validate the extracted `cuisine` value against the cuisine enum using the recipeSchema
6. IF the extracted `category` value does not match any value in the canonical enum or the extracted `cuisine` value does not match any value in the cuisine enum (including null), THEN THE BedrockAdapter SHALL reject the extraction result with a schema validation error indicating which field contained the invalid value

### Requirement 3: Recipe Backfill

**User Story:** As a user, I want existing recipes to be re-processed with the updated extraction prompt, so that all recipes have category and cuisine assignments for chapter grouping.

#### Acceptance Criteria

1. WHEN the backfill process is invoked for a job, THE system SHALL retrieve all existing recipe records from DynamoDB for that job and re-submit the persisted OCR text for each recipe through the BedrockAdapter extraction prompt, using bounded concurrency controlled by the `--concurrency` flag (default: 5) to limit how many Bedrock API calls execute in parallel (e.g., p-limit pattern)
2. WHEN the backfill process completes extraction for a recipe, THE system SHALL overwrite the corresponding DynamoDB record (keyed by jobName + recipeNumber) with the full extraction output, preserving the existing jobName, recipeNumber, source, and imageKeys values while updating all FM-derived fields including category and cuisine
3. THE backfill process SHALL NOT re-invoke AWS Textract OCR, using only the previously persisted OCR text stored in each recipe's DynamoDB record as input to the extraction prompt
4. IF the BedrockAdapter extraction fails for a single recipe during backfill, THEN THE system SHALL log the recipe number and error, patch the DynamoDB record with `category: "uncategorized"` and `cuisine: null` to satisfy the Recipe_Schema validation requirements, and continue processing the remaining recipes in the job
5. WHEN the backfill process completes for a job, THE system SHALL report the total number of recipes processed successfully and the number of recipes that failed extraction
6. WHEN the user invokes the backfill command, THE system SHALL accept a `--concurrency` flag with a positive integer value (default: 5) controlling the maximum number of parallel Bedrock API calls
7. WHEN the Bedrock API returns a ThrottlingException during backfill, THE system SHALL retry the request using exponential backoff with jitter, with a maximum of 3 retry attempts per recipe before marking that recipe as failed

### Requirement 4: Author and Year Rendering

**User Story:** As a user, I want author and year attribution displayed on recipe pages, so that the cookbook preserves provenance of each recipe.

#### Acceptance Criteria

1. WHEN a recipe has a non-null `author` field, THE PdfKitAdapter SHALL render an attribution line in the format "By [author]" in 10pt italic font, positioned between the recipe title and the source line
2. WHEN a recipe has both a non-null `author` and a non-null `year` field, THE PdfKitAdapter SHALL render the attribution line in the format "By [author], [year]" in 10pt italic font, positioned between the recipe title and the source line
3. WHEN a recipe has a null `author` and a non-null `year` field, THE PdfKitAdapter SHALL render the attribution line in the format "[year]" in 10pt italic font, positioned between the recipe title and the source line
4. WHEN a recipe has both null `author` and null `year` fields, THE PdfKitAdapter SHALL render no attribution line and SHALL leave no vertical gap between the recipe title and the source line
5. WHEN a recipe has a non-null `author` field with length exceeding 80 characters, THE PdfKitAdapter SHALL render the attribution line wrapping naturally within the page margins without truncation

### Requirement 5: Table of Contents with Page Numbers

**User Story:** As a user, I want a table of contents with accurate page numbers and chapter groupings, so that I can quickly navigate the printed cookbook.

#### Acceptance Criteria

1. THE PdfKitAdapter SHALL render a Table of Contents section starting on page 1 of the PDF document, occupying as many pages as needed to list all entries at a density of no more than 40 entries (chapter headings plus recipe titles) per page
2. THE TOC SHALL display recipe titles grouped under their chapter category headings, with chapter headings rendered flush-left and recipe titles indented 18pt from the left margin beneath their heading
3. WHEN a TOC entry is rendered, THE PdfKitAdapter SHALL display the recipe title (truncated with an ellipsis if it exceeds 70 characters) followed by Dot_Leaders and the page number where the recipe begins, offset by the total TOC page count
4. THE PdfKitAdapter SHALL use Body_TOC_Merge rendering: (1) render all body content (chapter dividers, recipe pages, source appendix) to a temporary body.pdf file, collecting each recipe's page number during rendering; (2) calculate the TOC page count from the collected entries and render toc.pdf as a separate document with page numbers offset by the TOC page count; (3) merge toc.pdf and body.pdf into the final output file using pdf-lib to produce a valid PDF with correct cross-reference tables and byte offsets
5. THE TOC SHALL list chapters in the canonical 14-category order (Appetizers & Snacks, Soups & Stews, Salads & Dressings, Beef & Pork, Poultry, Seafood, Pasta & Rice, Sides & Vegetables, Breads, Cakes, Pies & Pastries, Cookies & Bars, Beverages, Sauces & Condiments) followed by Odds & Ends (if present), and recipes alphabetically by title within each chapter
6. THE TOC SHALL NOT display recipeNumber values, as these are internal identifiers not meaningful in a rendered PDF
7. IF a chapter contains zero recipes, THEN THE PdfKitAdapter SHALL omit that chapter heading from the TOC entirely
8. IF the recipe collection is empty (zero recipes), THEN THE PdfKitAdapter SHALL omit the TOC section and begin the document with no TOC pages

### Requirement 6: Chapter Divider Pages

**User Story:** As a user, I want the cookbook organized into chapters by recipe category, so that I can browse recipes by type as in a traditional community cookbook.

#### Acceptance Criteria

1. WHEN rendering a PDF with chapters enabled, THE PdfKitAdapter SHALL render a Chapter_Divider page immediately before the first recipe of each non-empty category group, and SHALL NOT render a Chapter_Divider page for categories that contain zero recipes
2. THE Chapter_Divider page SHALL display the category name centered horizontally and vertically on the page using 28pt bold font
3. THE ExportService SHALL group recipes by their `category` field and order the groups following the canonical sequence: Appetizers & Snacks, Soups & Stews, Salads & Dressings, Beef & Pork, Poultry, Seafood, Pasta & Rice, Sides & Vegetables, Breads, Cakes, Pies & Pastries, Cookies & Bars, Beverages, Sauces & Condiments
4. WHEN a recipe has a category value of "uncategorized", THE ExportService SHALL assign the recipe to a chapter titled "Odds & Ends" which appears after all canonical category chapters in the PDF rendering order. Note: "uncategorized" recipes originate only from pre-migration data or failed backfill extraction (per Requirement 3 criterion 4), not from the Bedrock extraction pipeline.
5. WITHIN each chapter, THE ExportService SHALL sort recipes alphabetically by title using case-insensitive comparison
6. IF the `--no-chapters` flag is set, THEN THE PdfKitAdapter SHALL render recipes in a flat alphabetical sequence without Chapter_Divider pages

### Requirement 7: Source Appendix

**User Story:** As a user, I want an appendix listing recipes by their source collection, so that I can trace which cookbook or card set each recipe came from.

#### Acceptance Criteria

1. WHEN rendering a PDF with chapters enabled, THE PdfKitAdapter SHALL render a Source Appendix section after all recipe chapters
2. THE Source Appendix SHALL list each distinct source value as a heading with the recipe titles from that source listed beneath it, sorted alphabetically by title
3. THE Source Appendix SHALL use a compact layout with 9pt body text, 6pt spacing between entries, and 10pt bold source headings
4. THE Source Appendix sources SHALL be ordered alphabetically by source name
5. IF a recipe has an empty or blank source value, THEN THE Source Appendix SHALL group that recipe under a heading titled "Unknown Source"

### Requirement 8: Multi-Recipe Page Layout

**User Story:** As a user, I want short recipes to share a page when they fit, so that the cookbook uses space efficiently without wasting full pages on brief recipes.

#### Acceptance Criteria

1. WHEN a recipe finishes rendering and the remaining page space (pageHeight minus top and bottom margins minus current vertical position) exceeds the estimated height of the next recipe in the same chapter plus 24.5pt for the horizontal rule separator (12pt spacing above, 0.5pt rule stroke, 12pt spacing below), THE PdfKitAdapter SHALL render the next recipe on the same page preceded by a horizontal rule spanning the full content width
2. WHEN the remaining page space does not accommodate the next recipe's estimated height plus 24pt separator overhead, THE PdfKitAdapter SHALL start the next recipe on a new page
3. THE PdfKitAdapter SHALL estimate recipe height by measuring each text block using pdfkit's `doc.heightOfString(text, { width: contentWidth })` which accounts for actual font metrics, word wrap, and available content width. The total estimated height is the sum of measured heights for all text blocks (title, attribution, section headings, ingredients, instructions, notes) plus fixed spacing overhead (24pt + 12pt per section heading + inter-item spacing).
4. THE PdfKitAdapter SHALL NOT place recipes from different chapters on the same page
5. IF a recipe's actual rendered content exceeds the remaining page space despite passing the height estimate, THEN THE PdfKitAdapter SHALL use `doc.heightOfString` measurement to detect insufficient space and trigger a page break with continuation header, rather than relying on pdfkit's automatic text wrapping across pages

### Requirement 9: Overflow Pagination

**User Story:** As a user, I want long recipes to flow naturally across pages with continuation headers, so that I know which recipe I am reading on subsequent pages.

#### Acceptance Criteria

1. THE PdfKitAdapter SHALL use pdfkit's `doc.heightOfString(text, { width: contentWidth })` to measure each content block before rendering it. If the measured height exceeds remaining page space (pageHeight minus bottom margin minus current Y position), the adapter SHALL trigger a manual page break and render the continuation header before the content block.
2. WHEN remaining page space is insufficient for the next content block, THE PdfKitAdapter SHALL trigger a manual page break and render a continuation header in the format "[Recipe Title], continued" at the top of the new page, before any recipe body content, using the recipe title font style
3. IF a recipe's content fits entirely within a single page, THEN THE PdfKitAdapter SHALL NOT render a continuation header for that recipe

### Requirement 10: Typography and Layout

**User Story:** As a user, I want professional typography and consistent spacing in the PDF, so that the cookbook is pleasant to read and suitable for printing.

#### Acceptance Criteria

1. THE PdfKitAdapter SHALL apply the following type scale: Chapter_Divider title at 28pt Helvetica-Bold, recipe title at 18pt Helvetica-Bold, section headings at 12pt Helvetica-Bold, body text at 11pt Times-Roman, attribution text at 10pt Times-Italic, footer and image references at 8pt Helvetica with 0.4 grayscale color
2. THE PdfKitAdapter SHALL use Helvetica (and Helvetica-Bold) for chapter titles, recipe titles, section headings, page numbers, and image references, and Times-Roman (and Times-Italic) for body text and attribution text
3. THE PdfKitAdapter SHALL apply page margins of 72pt (1 inch) on all sides
4. THE PdfKitAdapter SHALL render page numbers centered in the page footer, using 8pt font at 0.4 grayscale, positioned at the bottom margin, on all pages except the TOC and Chapter_Divider pages
5. THE PdfKitAdapter SHALL apply consistent vertical spacing: 24pt before recipe title, 12pt before each section heading, 6pt between body-text list items, and 4pt between the last content line and the next section within a recipe
6. WHEN multiple recipes are rendered on the same page, THE PdfKitAdapter SHALL insert a horizontal rule separator with 18pt vertical space above and below between consecutive recipes

### Requirement 11: Image Embedding

**User Story:** As a user, I want source recipe card images optionally embedded in the PDF, so that I can see the original handwriting alongside the transcription.

#### Acceptance Criteria

1. WHEN the image mode is set to "thumbnail", THE PdfKitAdapter SHALL embed each recipe's source images as inline thumbnails at a maximum width of 300px (150 DPI at 2 inches), preserving aspect ratio, where the source image has been downsampled to 150 DPI target resolution before embedding
2. WHEN the image mode is set to "full", THE PdfKitAdapter SHALL embed each recipe's source images at a maximum width of 975px (150 DPI at 6.5 inches) on a separate page following the recipe, preserving aspect ratio, where the source image has been downsampled to 150 DPI target resolution before embedding
3. WHEN the image mode is set to "none", THE PdfKitAdapter SHALL NOT embed images and SHALL NOT render image reference text
4. WHEN a recipe has multiple imageKeys, THE PdfKitAdapter SHALL render all associated images in sequence
5. THE PdfKitAdapter SHALL resolve imageKeys to local file paths by extracting the filename portion after the job-name prefix and resolving against `jobs/<jobName>/images/<filename>`
6. IF a local image file does not exist and the image mode requires embedding (thumbnail or full), THEN THE PdfKitAdapter SHALL render placeholder text "Source image not available" in 8pt gray italic font instead of crashing
7. WHEN the image mode requires embedding (thumbnail or full), THE PdfKitAdapter SHALL downsample each source image to the target DPI (150 DPI) at the target rendered width using sharp during an asynchronous pre-processing phase that completes before the PdfRendererPort render method is invoked, reducing memory usage and PDF file size
8. BEFORE the PdfRendererPort render method is invoked, ALL image downsampling and local path resolution SHALL be completed as an asynchronous pre-processing phase. The render method SHALL receive pre-processed image file paths (already downsampled to target dimensions) and SHALL NOT perform any asynchronous image processing during PDF stream construction.

### Requirement 12: Headers and Footers

**User Story:** As a user, I want contextual headers on recipe pages showing the current chapter and recipe, so that I can orient myself when flipping through the printed book.

#### Acceptance Criteria

1. WHEN rendering a recipe content page, THE PdfKitAdapter SHALL display the chapter category name left-aligned in the page header and the title of the first recipe that begins on that page right-aligned in the page header, both in 8pt font within the top margin area
2. THE PdfKitAdapter SHALL NOT render headers or footers on TOC pages or Chapter_Divider pages
3. THE PdfKitAdapter SHALL render the page number as a centered Arabic numeral in the footer of each recipe content page, where page 1 is the first page following the TOC
4. IF a chapter category name or recipe title exceeds 50 characters in the header, THEN THE PdfKitAdapter SHALL truncate the text with an ellipsis so that the left-aligned and right-aligned header elements do not overlap
5. THE PdfKitAdapter SHALL NOT write page headers eagerly on page creation. Instead, the adapter SHALL track which recipe starts on each page during body rendering and retroactively stamp headers at fixed absolute coordinates (using pdfkit's `doc.text(text, x, y)` positioning) before finalizing each page in the body pass.

### Requirement 13: Decorative Elements

**User Story:** As a user, I want subtle decorative rules in the PDF, so that recipes are visually separated and the layout feels polished.

#### Acceptance Criteria

1. WHEN multiple recipes share a page, THE PdfKitAdapter SHALL render a horizontal rule spanning the full printable width (margin to margin) between them, with a stroke width of 0.5pt, a muted gray stroke color, and 12pt vertical space above and below the rule
2. THE PdfKitAdapter SHALL render a decorative rule beneath each recipe title with a stroke width of 0.5pt, a muted gray stroke color, spanning the full printable width, positioned 4pt below the title text baseline

### Requirement 14: CLI Options

**User Story:** As a user, I want CLI options to control PDF output format, so that I can customize the cookbook for different use cases.

#### Acceptance Criteria

1. WHEN the user invokes `heirloom export pdf`, THE ExportHandler SHALL accept the following options: `--images` (values: none, thumbnail, full; default: thumbnail), `--page-size` (values: letter, a4; default: letter), `--multi-per-page` (boolean flag; default: true), `--confidence` (boolean flag; default: true), `--no-chapters` (boolean flag; default: false)
2. IF the user provides an unrecognized option or an invalid value for a recognized option, THEN THE ExportHandler SHALL print an error message indicating the invalid option or value along with the list of accepted values, set exit code to 1, and SHALL NOT produce a PDF file
3. WHEN `--no-chapters` is specified, THE ExportService SHALL produce a flat recipe list sorted alphabetically by recipe title (case-insensitive) with no chapter grouping, no Chapter_Divider pages, and no chapter headings in the TOC
4. WHEN `--confidence` is set to false, THE PdfKitAdapter SHALL NOT render low-confidence warning markers on recipe fields
5. WHEN `--multi-per-page` is set to false, THE PdfKitAdapter SHALL render each recipe starting on a new page regardless of available space
6. WHEN `--page-size` is set to "a4", THE PdfKitAdapter SHALL use A4 page dimensions (595.28 x 841.89 points) instead of US Letter (612 x 792 points)
7. WHEN `--images` is set to "none", THE PdfKitAdapter SHALL omit all source images from recipe sections
8. WHEN `--images` is set to "thumbnail", THE PdfKitAdapter SHALL render each source image inline at a maximum width of 300px (150 DPI at 2 inches), preserving aspect ratio
9. WHEN `--images` is set to "full", THE PdfKitAdapter SHALL render each source image at a maximum width of 975px (150 DPI at 6.5 inches), preserving aspect ratio

### Requirement 15: PdfRenderOptions Port Interface

**User Story:** As a developer, I want rendering options passed through the port interface as a typed object, so that the domain layer controls output behavior without coupling to adapter internals.

#### Acceptance Criteria

1. THE PdfRendererPort interface SHALL accept a `PdfRenderOptions` parameter containing: an `imageMode` field restricted to `"none"`, `"thumbnail"`, or `"full"`, a `pageSize` field restricted to `"letter"` or `"a4"`, a boolean `multiPerPage` flag, a boolean `confidenceMarkers` flag, and a boolean `chapterGrouping` flag
2. THE PdfRendererPort interface SHALL accept grouped recipe data as an ordered array of chapter objects, where each chapter object contains a `chapter` property (non-empty string) and a `recipes` property (non-empty array of Recipe), rather than a flat Recipe array
3. WHEN the user invokes the export command with PDF format, THE ExportHandler SHALL parse CLI arguments into a PdfRenderOptions object with defaults of imageMode: "thumbnail", pageSize: "letter", multiPerPage: true, confidenceMarkers: true, and chapterGrouping: true, and pass the options to the ExportService
4. THE ExportService (or a dedicated pre-processing step) SHALL handle image preparation (downsampling and path resolution) before passing data to the PdfRendererPort render method, and SHALL pass the PdfRenderOptions and grouped recipe data (with pre-processed image paths) to the PdfRendererPort render method
5. IF the ExportHandler receives an unrecognized value for `--images` or `--page-size`, THEN THE ExportHandler SHALL reject the command with an error message indicating the valid values and set a non-zero exit code without invoking the ExportService
