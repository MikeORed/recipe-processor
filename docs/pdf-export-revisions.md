# PDF Export — Gap Analysis & Revision Plan

Status: **Draft for Review**
Generated: 2026-06-15

---

## Summary

This document compares the README's intended PDF export behavior against the current `PdfKitAdapter` implementation, identifies gaps and deltas, and proposes explicit revisions to reach a near-v1 polish level. The Obsidian vault export is included where its structure informs PDF design decisions (shared data model, shared ordering).

---

## 1. Data Model Alignment

### Current Recipe model (`recipe.ts`)

```
jobName, recipeNumber, source, title, author (nullable), year (nullable),
tags[], ingredients[], instructions[], notes[], imageKeys[], confidence{}
```

### What the PDF adapter actually uses

| Field | Used? | How |
|-------|-------|-----|
| recipeNumber | ✅ | TOC numbering, section prefix |
| title | ✅ | TOC entry, section heading |
| source | ✅ | Small line under title |
| author | ❌ | Not rendered |
| year | ❌ | Not rendered |
| tags | ❌ | Not rendered (no category grouping) |
| ingredients | ✅ | Bulleted list |
| instructions | ✅ | Numbered list |
| notes | ✅ | Bulleted list |
| imageKeys | ✅ | Gray footnote line |
| confidence | ✅ | ⚠️ markers |

### Delta

- **author** and **year** exist in the domain model and are populated by the FM extraction (Obsidian vault renders them) but the PDF ignores them entirely.
- **tags** could drive category/chapter grouping (the README says "grouped by category or source order") but are unused.
- **source** is rendered as flat text, not used for grouping/chaptering.

### Revisions needed

1. Render `author` as attribution line beneath title using "By [name]" format. <agree></agree>
2. Render `year` when present, alongside author. <agree></agree>
3. Use category-type tags (appetizer, meat, pasta, fish, etc.) from `tags[]` to drive chapter grouping (see §3). A canonical list of recipe-type tags must be established as a prerequisite. A separate canonical list for cuisine tags is also needed but serves other contexts (per-recipe display, appendix), not PDF chapter structure. <agree></agree>

---

## 2. Table of Contents

### README intent

> "Table of contents with page numbers, recipes grouped by category or source order"

### Current implementation

- Single flat list of `"{recipeNumber}. {title}"` entries.
- No page numbers (pdfkit buffers pages but the TOC is rendered on page 1 before recipe pages exist — no cross-referencing of page destinations).
- No grouping by category or source.
- Alphabetical? No — uses the order passed in (lexicographic by `recipeNumber` from ExportService).

### Revisions needed

4. **Page numbers in TOC**: Use pdfkit's `bufferedPageRange` or a two-pass approach (render body first with tracked positions, then prepend TOC pages with accurate page numbers). Alternatively, use pdf-lib post-processing or pdfkit's built-in page refs. <agree></agree>
5. **Chapter grouping in TOC**: Group entries under category-type tag headings (e.g. "Appetizers", "Beef & Pork", "Desserts"). Indent recipe titles under their chapter heading. Source is not a grouping axis — it is displayed per-recipe and listed in an appendix. Same for cuisine. <agree></agree>
6. **TOC entry format**: Recipe title + dot leaders + page number. No `recipeNumber` displayed — recipe numbers are internal identifiers, useful in Obsidian frontmatter for traceability but not meaningful in a rendered PDF. Recipes within each chapter are ordered alphabetically by title. <agree></agree>
7. **Dot leaders**: Add dot-leader fills between title and page number for readability. <agree></agree>

---

## 3. Chapter / Section Structure

### README intent

> "recipes grouped by category or source order"

### Current implementation

No chapters exist. Every recipe gets `doc.addPage()` — flat sequence, one recipe per page, no grouping.

### Available grouping data

- `tags[]` — category-type tags (appetizer, meat, dessert, etc.) are the primary grouping axis for PDF chapters.
- `source` field — displayed per-recipe and in an appendix; not used for chaptering.
- `recipeNumber` — internal identifier only; not displayed in PDF.

### Revisions needed

8. **Chapter divider pages**: For each distinct category-type tag, render a chapter divider page with the category name, styled distinctly (larger font, centered, possibly decorative rule). Recipes are assigned to chapters based on their category tag from `tags[]`. The divider page serves as the hard physical break between categories — no recipe content crosses category boundaries. <agree></agree>
9. **Chapter ordering**: Chapters follow the canonical category-type tag list order (to be defined — likely: Appetizers & Snacks, Soups & Chowders, Salads & Dressings, Beef & Pork, Poultry, Seafood, Sides & Vegetables, Pasta & Rice, Breads, Cakes, Pies, Cookies & Bars, Desserts, Beverages, Sauces & Condiments). Within a chapter, recipes are ordered alphabetically by title. <agree></agree>
10. **Uncategorized fallback**: Recipes lacking a category-type tag are tagged `uncategorized` in the data model. In the rendered PDF, this chapter is titled **"Odds & Ends"** rather than "Uncategorized". Its presence signals that the FM extraction or a backfill pass needs attention. <agree></agree>
11. **Source appendix**: After all recipe chapters, render an appendix page listing each distinct source with the recipes that came from it (title only, no full re-render). The appendix should be visually dense — compact layout, smaller type, tightly packed — compared to the generous spacing of recipe chapters. Provides traceability without cluttering the main structure. <agree></agree>

---

## 4. Recipe Page Formatting

### Current implementation

Each recipe gets one full page regardless of length. A short recipe (4 ingredients, 2 instructions) wastes most of the page. A long recipe with extensive notes might overflow without pagination handling.

### README intent

> (implicit from "print-ready PDF cookbook" — physical cookbooks routinely fit 2 short recipes per page)

### Revisions needed

12. **Multi-recipe-per-page for short recipes**: If a recipe's rendered height is below a threshold (e.g., < 40% of printable area), attempt to fit the next recipe on the same page with a horizontal rule separator. Fall back to new page if the next recipe wouldn't fit. <agree></agree>
13. **Page break for long recipes**: If a recipe overflows a single page, allow it to flow across pages naturally (pdfkit handles this if we don't force `addPage()` per recipe). Add a continuation header on overflow pages ("Recipe Title, continued"). <agree></agree>
14. **Minimum isolation rule**: Recipes from different chapters always start on a new page. Multi-per-page only applies within the same chapter. Chapter divider pages (item 8) guarantee physical separation between categories. <agree></agree>
15. **Per-recipe vertical spacing**: Add consistent vertical margins: 24pt before title, 12pt before each section heading, 6pt between list items. <agree></agree>

---

## 5. Image Placement

### README intent

> "optional thumbnail of the original card alongside the transcription"

### Current implementation

Image keys are rendered as a small gray text line at the bottom: `Images: family-recipe-book/Scan_20260613_164341.jpg`. No actual image embedding.

### Available data

- `imageKeys` contains S3 keys like `family-recipe-book/Scan_20260613_164341.jpg`
- Local images exist at `jobs/<jobName>/images/<filename>` (README confirms: "Images embedded in exports reference the local `jobs/<job-name>/images/` path, no re-download from S3")

### Revisions needed

16. **Resolve local image paths**: Map `imageKeys` → local paths via pattern: strip the job-name prefix from the S3 key and resolve against `jobs/<jobName>/images/`. E.g., `family-recipe-book/Scan_20260613_164341.jpg` → `jobs/family-recipe-book/images/Scan_20260613_164341.jpg`. <agree></agree>
17. **Thumbnail embedding (optional mode)**: When `--images thumbnail` or `--images full` is set, embed scaled source images alongside the recipe. Placement options:
    - **Inline** (`thumbnail`): Small thumbnail (e.g. 120px width) floated right of the title/ingredients area.
    - **Footer** (`thumbnail`): Small thumbnail at bottom of recipe section.
    - **Separate page** (`full`): Full-width reproduction on the facing page (for archival/keepsake editions).
    - **None** (`none`): No image embedding, no image reference text. <agree></agree>
18. **Multiple images per recipe**: When a recipe has multiple `imageKeys` (e.g., front and back of a card), show them in a small grid or sequence. <agree></agree>
19. **Graceful degradation**: If the local image file doesn't exist and the selected image mode requires images (`thumbnail` or `full`), render a placeholder text note ("Source image not available") rather than crashing. In `none` mode, missing files are irrelevant and produce no warning. <agree></agree>
20. **Image mode as a CLI option**: `--images none` (no images at all), `--images thumbnail` (inline scaled), `--images full` (archival full page). <agree></agree>

---

## 6. Typography & Layout

### Current implementation

- Font sizes: 24pt (TOC heading), 20pt (recipe title), 14pt (section headings), 10pt (body), 8pt (image refs).
- No font choice (pdfkit defaults to Helvetica).
- No page margins specified (pdfkit defaults: 72pt all sides).
- No header/footer.

### Revisions needed

21. **Consistent typography scale**: Define a type scale appropriate for a printed cookbook:
    - Chapter title: 28pt, bold
    - Recipe title: 18pt, bold
    - Section headings (Ingredients, Instructions, Notes): 12pt, bold
    - Body text: 11pt
    - Attribution (author/year/source): 10pt, italic
    - Image references / footer: 8pt, gray <agree></agree>
22. **Font selection**: Use pdfkit's built-in fonts (Helvetica for headings, Times-Roman for body) for zero-dependency simplicity. Bundled libre fonts can be layered in later without architectural changes. <agree></agree>
23. **Page margins**: Set generous margins for print: 72pt (1 inch) on all sides, or 90pt inner margin for bound books (gutter margin). <agree></agree>
24. **Headers and footers**: 
    - Header: chapter name (left), recipe title (right) — on recipe pages only, not on TOC or chapter dividers.
    - Footer: page number centered. <agree></agree>
25. **Decorative elements**: Optional horizontal rule between recipes on shared pages. Optional thin rule under recipe title. <agree></agree>

---

## 7. CLI Options (Minimum Set)

### Current implementation

`heirloom export pdf [--job <name>]` — no formatting options at all.

### Revisions needed

26. Define the minimum option set for PDF export:

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--job <name>` | string | active job | Which job to export |
| `--images` | `none`, `thumbnail`, `full` | `thumbnail` | Image embedding mode |
| `--page-size` | `letter`, `a4` | `letter` | Physical page size |
| `--multi-per-page` | boolean flag | `true` | Allow short recipes on same page |
| `--confidence` | boolean flag | `true` | Show ⚠️ review markers |
| `--no-chapters` | boolean flag | `false` | Flat output with no chapter grouping |

<agree></agree>

27. These options should be parsed by `ExportHandler` and threaded through to `PdfRendererPort` via an options object (new `PdfRenderOptions` type on the port interface). <agree></agree>

---

## 8. Vault Export — Parallel Gaps (Lower Priority)

These are noted for completeness since the README describes a richer vault structure than what's currently produced. Not blocking PDF v1 but worth tracking.

| README Intent | Current State | Gap |
|---|---|---|
| `vault/Recipes/` subdirectory | Flat in `vault/` root | No subdirectory structure |
| `vault/Sources/` with dataview pages | Not generated | Missing |
| `vault/Attachments/originals/` with copied images | Not generated | Missing |
| `vault/README.md` | Not generated (`_index.md` instead) | Different file |
| Tags as `source/<source-snake-name>` | `[[source:Family Recipe Book]]` wikilink instead | Different mechanism |
| Confidence scores in frontmatter | Not in frontmatter | Missing |
| Filename includes recipeNumber prefix | Current code produces slug-only (e.g. `barbequed-brisket.md`) | Code changed but disk files are from old version with `<num>-<slug>.md` format — need to decide which to keep |
| `author` in frontmatter | Present in `renderRecipeMarkdown` | ✅ Works |
| `year` in frontmatter | Present in `renderRecipeMarkdown` | ✅ Works |
| Category tags | Not populated from FM extraction for this job | Data gap |

---

## 9. FM Extraction Prompt Augmentation (Prerequisite for §9 Backfill)

The current Bedrock extraction prompt (`bedrock-adapter.ts → buildPrompt`) needs substantive changes to support the canonical category system. This is not just a schema tweak — the prompt itself needs classification guidance so the FM produces consistent, correct category assignments.

### Current state

- `tags` is described as a freeform multi-select with a loose example list: `appetizer, main, dessert, salad, beverage, bread, side, soup, candy, cookie, pie, cake, casserole, sandwich`
- No `cuisine` field exists
- No guidance on how to handle ambiguous recipes (chicken pasta, shrimp casserole, etc.)
- Values don't match the canonical 14-category list we've defined

### Required changes

#### A. Schema changes

1. **Add `category` field** — required, single-select, constrained to the 14-item enum:
   ```
   Appetizers & Snacks | Soups & Stews | Salads & Dressings | Beef & Pork |
   Poultry | Seafood | Pasta & Rice | Sides & Vegetables | Breads |
   Cakes | Pies & Pastries | Cookies & Bars | Beverages | Sauces & Condiments
   ```
   This replaces the category role that `tags` was loosely filling.

2. **Add `cuisine` field** — nullable, single-select from a cuisine enum:
   ```
   American/Southern | Tex-Mex | Italian | Chinese/Asian | French |
   Cajun/Creole | German/Eastern European | Mediterranean | Other | null
   ```
   Displayed per-recipe in the PDF and useful in vault tagging. Not used for chaptering.

3. **Retain `tags[]`** — for freeform supplementary tags (e.g., "quick", "make-ahead", "holiday", "kid-friendly"). No longer carries the category-type responsibility.

#### B. Classification heuristic in prompt body

Add explicit guidance:

```
Classification rules for category:
- Classify by PRIMARY PROTEIN first: if the star of the dish is beef, pork, chicken, 
  turkey, shrimp, or fish, file under that protein's chapter (Beef & Pork, Poultry, Seafood).
- If no protein dominates, classify by DISH STRUCTURE: pasta/rice dishes go under 
  Pasta & Rice, vegetable-forward dishes under Sides & Vegetables.
- Casseroles are filed by their primary protein, not as a separate category.
- Sandwiches are filed by primary protein, or under Breads if no protein dominates.
- Dips, spreads, and finger foods are Appetizers & Snacks.
- Gelatin salads and fruit salads are Salads & Dressings.
- Candy goes under Cookies & Bars.
- Frozen/chilled desserts (tortoni, ice cream) go under Cookies & Bars.
- If genuinely ambiguous, prefer the protein chapter over the structural one.
```

#### C. Disambiguation examples (few-shot)

Include 2-3 edge cases in the prompt to anchor classification:

| Recipe | Category | Why |
|--------|----------|-----|
| Chicken-Broccoli Casserole | Poultry | Primary protein is chicken |
| Chinese Rice (with pork) | Pasta & Rice | Rice is the star, pork is supporting |
| Shrimp Gumbo | Seafood | Primary protein is shrimp (not Soups & Stews) |
| Pecan Spread | Appetizers & Snacks | Finger food/spread, no protein star |
| Peanut Brittle Candy | Cookies & Bars | Candy falls under this chapter |

#### D. Confidence scope

The existing `confidence` object covers title/ingredients/instructions/notes. Consider adding confidence for `category` and `cuisine` — the FM may be uncertain about classification, and surfacing that lets the human reviewer know where to focus. Low-priority for v1 but worth noting.

### Impact on backfill

The re-run of FM extraction (resolved Q2) uses the updated prompt with these changes. Since the raw OCR text is already persisted, no Textract re-invocation is needed — just re-submit the OCR text per recipe group through the updated Bedrock prompt and overwrite the DynamoDB records with the enriched output.

---

## 10. Priority & Sequencing

### Prerequisite — Canonical category-type tag list & prompt augmentation

Before chapter grouping can work, a canonical list of recipe-type tags must be defined, the FM extraction prompt must be augmented with classification guidance (see §9), and the schema must be updated to include `category` (single-select) and `cuisine` (nullable). Existing records (106 recipes in `family-recipe-book`) need a backfill pass via re-run of FM extraction with the updated prompt.

### Phase 1 — Structural (must-have for v1 polish)

- [ ] Define canonical category-type tag list
- [ ] Define canonical cuisine tag list
- [ ] §9: Augment FM extraction prompt (schema + heuristic + examples)
- [ ] Backfill existing recipes via re-run FM extraction with updated prompt
- [ ] §1: Author/year rendering in PDF (By [name], year)
- [ ] §2: TOC with page numbers + dot leaders
- [ ] §3: Chapter divider pages, grouped by category-type tag
- [ ] §3: Source appendix (dense layout)
- [ ] §4: Multi-per-page logic for short recipes
- [ ] §4: Overflow pagination for long recipes
- [ ] §6: Typography scale + margins + page numbers

### Phase 2 — Visual polish

- [ ] §5: Image resolution + thumbnail embedding
- [ ] §6: Headers/footers with chapter + recipe context
- [ ] §6: Decorative rules

### Phase 3 — Options & flexibility

- [ ] §7: CLI options (--images, --page-size, --no-chapters, etc.)
- [ ] §7: PdfRenderOptions type threaded through port

### Phase 4 — Vault alignment (separate effort)

- [ ] §8: Vault subdirectory structure (Recipes/, Sources/, Attachments/)
- [ ] §8: Dataview source pages
- [ ] §8: Image copying to Attachments/
- [ ] §8: Filename convention decision (recipeNumber prefix or not)

---

## 11. Resolved Questions

1. **Canonical category-type tag list**: 14 categories, following standard community cookbook conventions:

   | Category | Covers |
   |----------|--------|
   | Appetizers & Snacks | dips, spreads, cheese balls, finger foods, hors d'oeuvres |
   | Soups & Stews | soups, chowders, chili, stews, gumbo |
   | Salads & Dressings | fruit salads, green salads, gelatin salads, dressings |
   | Beef & Pork | brisket, casseroles with ground beef, pork chops, ham |
   | Poultry | chicken, turkey |
   | Seafood | shrimp, fish |
   | Pasta & Rice | noodle dishes, fried rice, spaghetti, casseroles where pasta/rice is the star |
   | Sides & Vegetables | vegetable casseroles, potatoes, beans, grits, rice as a side |
   | Breads | biscuits, rolls, yeast breads |
   | Cakes | layer cakes, pound cakes, bundt cakes, sheet cakes |
   | Pies & Pastries | pies, tarts |
   | Cookies & Bars | cookies, brownies, squares, candy, frozen/chilled desserts |
   | Beverages | punch, tea, cocoa, cocktails |
   | Sauces & Condiments | chili sauce, marinades, condiment-style dressings |

   Casseroles are filed by primary protein or by sides, not as a separate chapter. FM prompt constrained to exactly this enum.

2. **Backfill approach**: Re-run FM extraction with updated prompt that produces canonical category and cuisine tags. No re-invocation of Textract needed — existing OCR text is already captured. The updated prompt adds a required single-select `category` field from the canonical list.

3. **Font licensing**: Zero-dep for now. Use pdfkit built-ins (Helvetica/Times-Roman). Bundled libre fonts can be added later without architectural changes.

4. **Image quality vs file size**: 150 DPI at rendered size.
   - `thumbnail` mode: ~300-400px wide (2 inches at 150 DPI), JPEG quality 75. ~30-50KB per image.
   - `full` mode: ~975px wide (6.5 inches at 150 DPI), JPEG quality 85. Larger but intentionally archival.
   - Source images are resized/compressed before embedding. pdfkit handles JPEG natively.

5. **Multi-recipe page threshold**: Measure actual remaining space rather than a fixed percentage. After rendering a recipe, check if `(pageHeight - margins - doc.y)` exceeds the estimated height of the next recipe (ingredient count × line height + instruction count × line height + fixed overhead for title/headings). If it fits, continue on same page with a horizontal rule separator. Otherwise `addPage()`. More accurate than a percentage heuristic.

6. **TOC approach**: Two-pass within pdfkit using `bufferPages: true` (already set in current code). Render all recipe/chapter pages first, tracking each recipe's page number as rendered. Then use `doc.switchToPage(0)` to write the TOC onto reserved front pages with collected page numbers. Single library, no post-processing dependency.

7. **Vault filename convention**: Out of scope for this document (PDF-focused). Deferred to vault alignment work in Phase 4.

8. **Recipes with multiple categories**: Primary category only, single placement. The FM prompt outputs a single required `category` field (not an array) from the canonical list. Classification biases toward primary protein; if no protein, classify by dish structure. Multiple tags remain valid in `tags[]` for other purposes (cuisine, source reference) but exactly one must be from the category-type list. Cross-referencing between chapters is deferred as a future enhancement.

---

## 12. Design Considerations

### A. Data model schema update (due course)

The `recipeSchema` in `recipe.ts` needs `category` (required string, constrained to the 14-item enum) and `cuisine` (nullable string, constrained to the cuisine enum). The DynamoDB adapter read/write logic, the Obsidian vault renderer (`renderRecipeMarkdown` frontmatter), and the PDF adapter (reads `category` for chapter assignment) all update as natural consequences of the model change. Standard ripple — no architectural surprises.

### B. ExportService owns grouping and sorting

The `ExportService` performs grouping and sorting based on the format and options passed in from the CLI handler. For PDF with chapters enabled, the service groups recipes by `category` (following canonical list order), sorts alphabetically by title within each group, and passes the grouped structure to the renderer. For `--no-chapters` or Obsidian export, the service sorts differently (e.g., alphabetical flat). The grouping logic lives in the domain service, not the adapter — the adapter receives already-organized data.

This means the `PdfRendererPort` interface may need to accept a grouped structure (e.g., `Map<string, Recipe[]>` or an ordered array of `{ chapter: string, recipes: Recipe[] }`) rather than a flat `Recipe[]`. The exact shape depends on implementation, but the key decision is: **grouping is the service's job, rendering is the adapter's job**.

### C. Image embedding without native dependencies (v1)

For v1, use pdfkit's built-in `doc.image(path, { width })` to scale images at render time directly from the source JPEG. This avoids adding `sharp` or other native image processing dependencies. File sizes will be larger (full source bytes embedded, rendered at smaller dimensions) but acceptable for a local-first CLI producing personal cookbooks.

If file size becomes a problem at scale (many recipes × multiple images), `sharp` can be added in a later pass to pre-resize before embedding. Not blocking for v1.

### D. TOC page reservation and offset

The two-pass TOC approach requires knowing how many pages the TOC will occupy before rendering it. Strategy: render all body pages first (chapters + recipes) without any TOC, collecting page numbers as you go. Then calculate the TOC page count from the collected entries (14 chapter headings + 106 recipe titles ≈ 3-4 pages at standard density). Prepend that many pages and write the TOC. All collected page numbers get offset by the TOC page count (body page 1 becomes actual page N+1 where N = TOC pages).

pdfkit's `bufferPages: true` supports this — pages can be reordered and written out of sequence before finalizing the document.
