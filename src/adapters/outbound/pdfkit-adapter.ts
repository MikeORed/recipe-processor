import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';

import type {
  PdfRendererPort,
  ChapterGroup,
  PdfRenderOptions,
  PageSize,
} from '../../domain/ports/pdf-renderer-port.js';
import type { Recipe } from '../../domain/models/recipe.js';

// ─── Page Layout Constants ────────────────────────────────────────────────────

export interface PageDimensions {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  contentWidth: number;
  contentHeight: number;
}

export const PAGE_LAYOUTS: Record<PageSize, PageDimensions> = {
  letter: {
    width: 612,
    height: 792,
    marginTop: 72,
    marginBottom: 72,
    marginLeft: 72,
    marginRight: 72,
    contentWidth: 468,
    contentHeight: 648,
  },
  a4: {
    width: 595.28,
    height: 841.89,
    marginTop: 72,
    marginBottom: 72,
    marginLeft: 72,
    marginRight: 72,
    contentWidth: 451.28,
    contentHeight: 697.89,
  },
};

// ─── Typography Scale Constants ───────────────────────────────────────────────

export const CHAPTER_DIVIDER_FONT_SIZE = 28;
export const RECIPE_TITLE_FONT_SIZE = 18;
export const SECTION_HEADING_FONT_SIZE = 12;
export const BODY_FONT_SIZE = 11;
export const ATTRIBUTION_FONT_SIZE = 10;
export const FOOTER_FONT_SIZE = 8;

// ─── Font Families ────────────────────────────────────────────────────────────

export const HEADING_FONT = 'Helvetica-Bold';
export const BODY_FONT = 'Times-Roman';
export const ITALIC_FONT = 'Times-Italic';
export const FOOTER_FONT = 'Helvetica';

// ─── Vertical Spacing Constants ───────────────────────────────────────────────

export const SPACE_BEFORE_RECIPE_TITLE = 24;
export const SPACE_BEFORE_SECTION_HEADING = 12;
export const SPACE_BETWEEN_LIST_ITEMS = 6;
export const SPACE_AFTER_LAST_CONTENT = 4;

// ─── Separator Overhead ───────────────────────────────────────────────────────

/** Separator: 12pt above + 0.5pt rule + 12pt below = 24.5pt total */
export const SEPARATOR_OVERHEAD = 24.5;

// ─── Confidence Threshold ─────────────────────────────────────────────────────

const LOW_CONFIDENCE_THRESHOLD = 0.7;

// ─── Exported Helpers ─────────────────────────────────────────────────────────

/**
 * Formats the continuation header text for overflow pagination.
 * Used when a recipe's content flows to a subsequent page.
 *
 * @returns "[title], continued"
 */
export function formatContinuationHeader(title: string): string {
  return `${title}, continued`;
}

/**
 * Pure decision function for multi-per-page layout.
 * Returns true iff the next recipe fits on the same page given remaining space
 * and estimated height, accounting for separator overhead (12pt above + 0.5pt rule + 12pt below).
 */
export function shouldFitOnSamePage(remainingSpace: number, estimatedHeight: number): boolean {
  return remainingSpace >= estimatedHeight + SEPARATOR_OVERHEAD;
}

/**
 * Formats the attribution line based on author and year values.
 * Exported as a standalone pure function for direct property-based testing.
 *
 * - Both non-null → "By [author], [year]"
 * - Only author → "By [author]"
 * - Only year → "[year]"
 * - Both null → null (no attribution line)
 */
export function formatAttribution(author: string | null, year: number | null): string | null {
  if (author && year) {
    return `By ${author}, ${year}`;
  } else if (author) {
    return `By ${author}`;
  } else if (year) {
    return `${year}`;
  }
  return null;
}

// ─── Page Assignment Simulation (exported for property testing) ────────────────

export interface PageAssignment {
  chapter: string;
  recipeTitle: string;
  pageIndex: number;
}

/**
 * Simulates page assignments for recipes across chapters.
 * Models the cross-chapter isolation invariant from renderBody():
 * - Each chapter's first recipe always starts on a new page
 * - Within a chapter, if the recipe fits on the same page (determined by `recipeFitsOnSamePage`),
 *   it shares the page; otherwise it gets a new page
 * - Different chapters never share a page
 *
 * Exported as a pure function for property-based testing of the page isolation property.
 */
export function simulatePageAssignments(
  chapters: Array<{ chapter: string; recipeTitles: string[] }>,
  recipeFitsOnSamePage: (recipeIndex: number) => boolean,
): PageAssignment[] {
  const assignments: PageAssignment[] = [];
  let currentPage = -1;

  for (const { chapter, recipeTitles } of chapters) {
    for (let i = 0; i < recipeTitles.length; i++) {
      if (i === 0) {
        // First recipe in chapter always gets a new page
        currentPage++;
      } else if (!recipeFitsOnSamePage(assignments.length)) {
        currentPage++;
      }
      // else: stays on same page (multi-per-page within same chapter)

      assignments.push({ chapter, recipeTitle: recipeTitles[i], pageIndex: currentPage });
    }
  }

  return assignments;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

/** Tracks position data collected during body rendering for TOC generation. */
interface RecipePageEntry {
  chapter: string;
  title: string;
  pageNumber: number;
}

/** Tracks which recipe/chapter owns each page for header stamping. */
interface PageOwnership {
  pageIndex: number;
  chapter: string;
  recipeTitle: string;
  type: 'recipe' | 'divider' | 'appendix';
}

/**
 * Outbound adapter that implements PdfRendererPort using pdfkit + pdf-lib.
 *
 * Rendering pipeline (Body_TOC_Merge):
 * 1. renderBody() — renders all chapters and recipes to a temp body.pdf, collecting page positions
 * 2. renderToc() — renders TOC pages as a separate toc.pdf with page numbers offset by TOC page count
 * 3. mergeDocuments() — merges toc.pdf + body.pdf into final output using pdf-lib
 */
export class PdfKitAdapter implements PdfRendererPort {
  async render(
    chapters: ChapterGroup[],
    options: PdfRenderOptions,
    outputPath: string,
  ): Promise<void> {
    // Ensure the output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    // Create a temporary directory for intermediate files
    const tempDir = join(tmpdir(), `heirloom-pdf-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const bodyPath = join(tempDir, 'body.pdf');
    const tocPath = join(tempDir, 'toc.pdf');

    try {
      const layout = PAGE_LAYOUTS[options.pageSize];

      // Step 1: Render body content (chapter dividers + recipes + source appendix)
      const { entries, pageOwnership } = await this.renderBody(
        chapters,
        options,
        layout,
        bodyPath,
      );

      // Step 2: Render TOC with offset page numbers
      const tocPageCount = await this.renderToc(entries, layout, tocPath);

      // Step 3: Merge toc.pdf + body.pdf into final output
      await this.mergeDocuments(tocPath, bodyPath, outputPath);

      // Step 4: Stamp headers/footers (operates on final merged PDF)
      await this.stampHeaders(outputPath, pageOwnership, tocPageCount, layout);
    } finally {
      // Clean up temp files
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  // ─── Body Rendering ───────────────────────────────────────────────────────

  /**
   * Renders all chapter dividers, recipe pages, and the source appendix
   * to a temporary body PDF. Collects recipe page positions for TOC generation
   * and page ownership data for header stamping.
   */
  private async renderBody(
    chapters: ChapterGroup[],
    options: PdfRenderOptions,
    layout: PageDimensions,
    outputPath: string,
  ): Promise<{ entries: RecipePageEntry[]; pageOwnership: PageOwnership[] }> {
    const entries: RecipePageEntry[] = [];
    const pageOwnership: PageOwnership[] = [];
    let bodyPageIndex = 0;

    const doc = new PDFDocument({
      autoFirstPage: false,
      size: [layout.width, layout.height],
      margins: {
        top: layout.marginTop,
        bottom: layout.marginBottom,
        left: layout.marginLeft,
        right: layout.marginRight,
      },
    });

    // Pipe to file
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    for (const chapter of chapters) {
      // Render chapter divider page (only if chapter grouping is enabled)
      if (options.chapterGrouping) {
        this.renderChapterDivider(doc, chapter.chapter, layout);
        pageOwnership.push({
          pageIndex: bodyPageIndex,
          chapter: chapter.chapter,
          recipeTitle: '',
          type: 'divider',
        });
        bodyPageIndex++;
      }

      for (let i = 0; i < chapter.recipes.length; i++) {
        const recipe = chapter.recipes[i];

        if (i === 0) {
          // First recipe in chapter always starts on a new page
          doc.addPage();
          pageOwnership.push({
            pageIndex: bodyPageIndex,
            chapter: chapter.chapter,
            recipeTitle: recipe.title,
            type: 'recipe',
          });

          entries.push({
            chapter: chapter.chapter,
            title: recipe.title,
            pageNumber: bodyPageIndex,
          });

          const startPage = bodyPageIndex;
          this.renderRecipe(doc, recipe, options, layout);
          // Track any new pages created during recipe rendering (overflow)
          const pagesAfterRender = doc.bufferedPageRange().count;
          while (bodyPageIndex < startPage + (pagesAfterRender - (startPage + 1))) {
            bodyPageIndex++;
            pageOwnership.push({
              pageIndex: bodyPageIndex,
              chapter: chapter.chapter,
              recipeTitle: recipe.title,
              type: 'recipe',
            });
          }
        } else {
          // Check if next recipe fits on current page (multi-per-page logic)
          const remainingSpace = layout.height - layout.marginBottom - doc.y;
          const estimatedHeight = this.estimateRecipeHeight(doc, recipe, options, layout);

          if (options.multiPerPage && remainingSpace >= estimatedHeight + SEPARATOR_OVERHEAD) {
            // Render separator and continue on same page
            this.renderSeparator(doc, layout);

            entries.push({
              chapter: chapter.chapter,
              title: recipe.title,
              pageNumber: bodyPageIndex,
            });

            this.renderRecipe(doc, recipe, options, layout);
            // Track overflow pages
            const pagesAfterRender = doc.bufferedPageRange().count;
            while (bodyPageIndex < pagesAfterRender - 1) {
              bodyPageIndex++;
              pageOwnership.push({
                pageIndex: bodyPageIndex,
                chapter: chapter.chapter,
                recipeTitle: recipe.title,
                type: 'recipe',
              });
            }
          } else {
            // Start new page
            doc.addPage();
            bodyPageIndex++;

            pageOwnership.push({
              pageIndex: bodyPageIndex,
              chapter: chapter.chapter,
              recipeTitle: recipe.title,
              type: 'recipe',
            });

            entries.push({
              chapter: chapter.chapter,
              title: recipe.title,
              pageNumber: bodyPageIndex,
            });

            this.renderRecipe(doc, recipe, options, layout);
            // Track overflow pages
            const pagesAfterRender2 = doc.bufferedPageRange().count;
            while (bodyPageIndex < pagesAfterRender2 - 1) {
              bodyPageIndex++;
              pageOwnership.push({
                pageIndex: bodyPageIndex,
                chapter: chapter.chapter,
                recipeTitle: recipe.title,
                type: 'recipe',
              });
            }
          }
        }
      }
    }

    // Render source appendix (stub until task 8.4)
    this.renderSourceAppendix(doc, chapters, layout);

    doc.end();

    // Wait for the write stream to finish
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    return { entries, pageOwnership };
  }

  /**
   * Renders a horizontal rule separator between recipes on the same page.
   * 12pt space above, 0.5pt rule in muted gray, 12pt space below.
   */
  private renderSeparator(doc: PDFKit.PDFDocument, layout: PageDimensions): void {
    const y = doc.y + 12; // 12pt space above
    doc.save();
    doc.strokeColor('#b3b3b3');
    doc.lineWidth(0.5);
    doc.moveTo(layout.marginLeft, y)
      .lineTo(layout.marginLeft + layout.contentWidth, y)
      .stroke();
    doc.restore();
    doc.y = y + 12; // 12pt space below
  }

  // ─── TOC Rendering ────────────────────────────────────────────────────────

  /**
   * Renders the table of contents as a separate PDF. Page numbers displayed
   * are offset by the TOC's own page count so they match the final merged document.
   *
   * @returns The number of TOC pages rendered.
   */
  private async renderToc(
    _entries: RecipePageEntry[],
    _layout: PageDimensions,
    _outputPath: string,
  ): Promise<number> {
    // TODO: Implement in task 8.1
    // - Calculate how many TOC pages are needed (max 40 entries per page)
    // - Render chapter headings flush-left, recipe titles indented 18pt
    // - Add dot leaders between title and page number
    // - Offset page numbers by TOC page count
    // - Skip TOC entirely if zero entries
    return 0;
  }

  // ─── PDF Merging ──────────────────────────────────────────────────────────

  /**
   * Merges toc.pdf + body.pdf into the final output PDF using pdf-lib.
   */
  private async mergeDocuments(
    _tocPath: string,
    _bodyPath: string,
    _outputPath: string,
  ): Promise<void> {
    // TODO: Implement in task 8.2
    // - Load both PDFs with pdf-lib
    // - Create new document, copy TOC pages first, then body pages
    // - Write merged result to outputPath
  }

  // ─── Chapter Divider ──────────────────────────────────────────────────────

  /**
   * Renders a full-page chapter divider with the category title centered
   * horizontally and vertically (28pt Helvetica-Bold).
   */
  private renderChapterDivider(
    doc: PDFKit.PDFDocument,
    chapterTitle: string,
    layout: PageDimensions,
  ): void {
    doc.addPage();
    doc.font(HEADING_FONT).fontSize(CHAPTER_DIVIDER_FONT_SIZE);

    // Calculate vertical center: account for text height
    const textHeight = doc.heightOfString(chapterTitle, {
      width: layout.contentWidth,
      align: 'center',
    });
    const verticalCenter = layout.marginTop + (layout.contentHeight - textHeight) / 2;

    doc.text(chapterTitle, layout.marginLeft, verticalCenter, {
      width: layout.contentWidth,
      align: 'center',
    });
  }

  // ─── Recipe Rendering ─────────────────────────────────────────────────────

  /**
   * Renders a single recipe with title, attribution, source, sections
   * (ingredients, instructions, notes), confidence markers, and image references.
   */
  private renderRecipe(
    doc: PDFKit.PDFDocument,
    recipe: Recipe,
    options: PdfRenderOptions,
    layout: PageDimensions,
  ): void {
    const currentRecipeTitle = recipe.title;

    // --- Title (18pt Helvetica-Bold, 24pt space before) ---
    doc.y += SPACE_BEFORE_RECIPE_TITLE;
    doc.font(HEADING_FONT).fontSize(RECIPE_TITLE_FONT_SIZE);
    doc.text(recipe.title, layout.marginLeft, doc.y, { width: layout.contentWidth });

    // --- Decorative rule under title (0.5pt, muted gray, 4pt below title) ---
    const ruleY = doc.y + 4;
    doc.save();
    doc.strokeColor('#b3b3b3');
    doc.lineWidth(0.5);
    doc.moveTo(layout.marginLeft, ruleY)
      .lineTo(layout.marginLeft + layout.contentWidth, ruleY)
      .stroke();
    doc.restore();
    doc.y = ruleY + 4;

    // --- Attribution line (10pt Times-Italic) ---
    const attributionLine = this.formatAttribution(recipe.author, recipe.year);
    if (attributionLine) {
      doc.font(ITALIC_FONT).fontSize(ATTRIBUTION_FONT_SIZE);
      this.renderTextBlock(doc, attributionLine, currentRecipeTitle, layout);
    }

    // --- Source line (10pt body font) ---
    if (recipe.source && recipe.source.trim() !== '') {
      doc.font(BODY_FONT).fontSize(ATTRIBUTION_FONT_SIZE);
      this.renderTextBlock(doc, `Source: ${recipe.source}`, currentRecipeTitle, layout);
    }

    // --- Sections ---
    const sections: Array<{ heading: string; items: string[]; confidenceKey: keyof Recipe['confidence'] }> = [
      { heading: 'Ingredients', items: recipe.ingredients, confidenceKey: 'ingredients' },
      { heading: 'Instructions', items: recipe.instructions, confidenceKey: 'instructions' },
    ];

    if (recipe.notes && recipe.notes.length > 0) {
      sections.push({ heading: 'Notes', items: recipe.notes, confidenceKey: 'notes' });
    }

    for (const section of sections) {
      if (section.items.length === 0) continue;

      // Section heading (12pt Helvetica-Bold, 12pt space before)
      let headingText = section.heading;
      if (options.confidenceMarkers && recipe.confidence[section.confidenceKey] < LOW_CONFIDENCE_THRESHOLD) {
        headingText += ' ⚠️';
      }

      doc.font(HEADING_FONT).fontSize(SECTION_HEADING_FONT_SIZE);

      // Check if section heading + first item fits on page, otherwise break
      const headingHeight = doc.heightOfString(headingText, { width: layout.contentWidth });
      const remainingForHeading = layout.height - layout.marginBottom - doc.y - SPACE_BEFORE_SECTION_HEADING;

      if (remainingForHeading < headingHeight + BODY_FONT_SIZE * 1.5) {
        // Not enough space for heading + at least one line
        doc.addPage();
        // Continuation header
        doc.font(HEADING_FONT).fontSize(RECIPE_TITLE_FONT_SIZE);
        doc.text(formatContinuationHeader(currentRecipeTitle), layout.marginLeft, layout.marginTop, {
          width: layout.contentWidth,
        });
        doc.y += 8;
      } else {
        doc.y += SPACE_BEFORE_SECTION_HEADING;
      }

      doc.font(HEADING_FONT).fontSize(SECTION_HEADING_FONT_SIZE);
      doc.text(headingText, layout.marginLeft, doc.y, { width: layout.contentWidth });

      // Body items (11pt Times-Roman, 6pt between items)
      doc.font(BODY_FONT).fontSize(BODY_FONT_SIZE);

      for (let i = 0; i < section.items.length; i++) {
        const item = section.items[i];

        // Measure item height to check for overflow
        doc.font(BODY_FONT).fontSize(BODY_FONT_SIZE);
        const itemHeight = doc.heightOfString(item, { width: layout.contentWidth });
        const remaining = layout.height - layout.marginBottom - doc.y;

        if (remaining < itemHeight) {
          // Page break with continuation header
          doc.addPage();
          doc.font(HEADING_FONT).fontSize(RECIPE_TITLE_FONT_SIZE);
          doc.text(formatContinuationHeader(currentRecipeTitle), layout.marginLeft, layout.marginTop, {
            width: layout.contentWidth,
          });
          doc.y += 8;
          doc.font(BODY_FONT).fontSize(BODY_FONT_SIZE);
        }

        doc.text(item, layout.marginLeft, doc.y, { width: layout.contentWidth });

        if (i < section.items.length - 1) {
          doc.y += SPACE_BETWEEN_LIST_ITEMS;
        }
      }
    }

    // --- Space after last content ---
    doc.y += SPACE_AFTER_LAST_CONTENT;

    // --- Image key references (8pt Helvetica, 0.4 grayscale) ---
    if (options.imageMode !== 'none' && recipe.imageKeys.length > 0) {
      doc.font(FOOTER_FONT).fontSize(FOOTER_FONT_SIZE);
      doc.fillColor('gray');
      const imageRefText = `Images: ${recipe.imageKeys.join(', ')}`;
      doc.text(imageRefText, layout.marginLeft, doc.y, { width: layout.contentWidth });
      doc.fillColor('black');
    }
  }

  /**
   * Formats the attribution line based on author and year values.
   * Delegates to the exported standalone function for testability.
   */
  private formatAttribution(author: string | null, year: number | null): string | null {
    return formatAttribution(author, year);
  }

  /**
   * Renders a text block with overflow detection. If the text won't fit on the
   * current page, triggers a page break with continuation header.
   */
  private renderTextBlock(
    doc: PDFKit.PDFDocument,
    text: string,
    recipeTitle: string,
    layout: PageDimensions,
  ): void {
    const textHeight = doc.heightOfString(text, { width: layout.contentWidth });
    const remaining = layout.height - layout.marginBottom - doc.y;

    if (remaining < textHeight) {
      doc.addPage();
      doc.font(HEADING_FONT).fontSize(RECIPE_TITLE_FONT_SIZE);
      doc.text(formatContinuationHeader(recipeTitle), layout.marginLeft, layout.marginTop, {
        width: layout.contentWidth,
      });
      doc.y += 8;
      // Restore the font/size that was set before calling this method
      // The caller should re-set if needed after this returns
    }

    doc.text(text, layout.marginLeft, doc.y, { width: layout.contentWidth });
  }

  // ─── Source Appendix ──────────────────────────────────────────────────────

  /**
   * Renders a compact source-grouped listing after all recipe chapters.
   * Groups by distinct source value (alphabetical), with recipes sorted
   * alphabetically within each group.
   */
  private renderSourceAppendix(
    _doc: PDFKit.PDFDocument,
    _chapters: ChapterGroup[],
    _layout: PageDimensions,
  ): void {
    // TODO: Implement in task 8.4
    // - Group all recipes by source (empty/blank → "Unknown Source")
    // - Sort groups alphabetically by source name
    // - Sort recipes within each group alphabetically by title
    // - Render with compact layout (9pt body, 6pt spacing, 10pt bold headings)
  }

  // ─── Height Estimation ────────────────────────────────────────────────────

  /**
   * Estimates the height a recipe will occupy on the page using
   * `doc.heightOfString()` for layout decisions (multi-per-page fit check).
   */
  private estimateRecipeHeight(
    doc: PDFKit.PDFDocument,
    recipe: Recipe,
    options: PdfRenderOptions,
    layout: PageDimensions,
  ): number {
    let totalHeight = 0;

    // Space before title
    totalHeight += SPACE_BEFORE_RECIPE_TITLE;

    // Title height
    doc.font(HEADING_FONT).fontSize(RECIPE_TITLE_FONT_SIZE);
    totalHeight += doc.heightOfString(recipe.title, { width: layout.contentWidth });

    // Decorative rule (4pt below title + 4pt below rule)
    totalHeight += 8;

    // Attribution line
    const attributionLine = this.formatAttribution(recipe.author, recipe.year);
    if (attributionLine) {
      doc.font(ITALIC_FONT).fontSize(ATTRIBUTION_FONT_SIZE);
      totalHeight += doc.heightOfString(attributionLine, { width: layout.contentWidth });
    }

    // Source line
    if (recipe.source && recipe.source.trim() !== '') {
      doc.font(BODY_FONT).fontSize(ATTRIBUTION_FONT_SIZE);
      totalHeight += doc.heightOfString(`Source: ${recipe.source}`, { width: layout.contentWidth });
    }

    // Sections: Ingredients, Instructions, Notes
    const sections: Array<{ items: string[] }> = [
      { items: recipe.ingredients },
      { items: recipe.instructions },
    ];
    if (recipe.notes && recipe.notes.length > 0) {
      sections.push({ items: recipe.notes });
    }

    for (const section of sections) {
      if (section.items.length === 0) continue;

      // Space before section heading
      totalHeight += SPACE_BEFORE_SECTION_HEADING;

      // Section heading height
      doc.font(HEADING_FONT).fontSize(SECTION_HEADING_FONT_SIZE);
      totalHeight += doc.heightOfString('Section', { width: layout.contentWidth });

      // Body items
      doc.font(BODY_FONT).fontSize(BODY_FONT_SIZE);
      for (let i = 0; i < section.items.length; i++) {
        totalHeight += doc.heightOfString(section.items[i], { width: layout.contentWidth });
        if (i < section.items.length - 1) {
          totalHeight += SPACE_BETWEEN_LIST_ITEMS;
        }
      }
    }

    // Space after last content
    totalHeight += SPACE_AFTER_LAST_CONTENT;

    // Image references (if applicable)
    if (options.imageMode !== 'none' && recipe.imageKeys.length > 0) {
      doc.font(FOOTER_FONT).fontSize(FOOTER_FONT_SIZE);
      const imageRefText = `Images: ${recipe.imageKeys.join(', ')}`;
      totalHeight += doc.heightOfString(imageRefText, { width: layout.contentWidth });
    }

    return totalHeight;
  }

  // ─── Header/Footer Stamping ───────────────────────────────────────────────

  /**
   * Retroactively stamps page headers (chapter name + recipe title) and
   * footers (centered page number) on recipe content pages of the final PDF.
   * TOC and chapter divider pages receive no headers or footers.
   */
  private async stampHeaders(
    _outputPath: string,
    _pageOwnership: PageOwnership[],
    _tocPageCount: number,
    _layout: PageDimensions,
  ): Promise<void> {
    // TODO: Implement in task 8.5
    // - Read the merged PDF with pdf-lib
    // - For each recipe content page, draw header text and page number footer
    // - Truncate header elements > 50 chars with ellipsis
    // - Use 8pt font, 0.4 grayscale for footers
    // - Skip TOC pages and chapter divider pages
    // - Write updated PDF back
  }
}
