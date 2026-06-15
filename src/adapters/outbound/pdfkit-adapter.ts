import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument, StandardFonts, rgb } from 'pdf-lib';

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

// ─── Header/Footer Decision Helpers (exported for property testing) ────────────

/** The possible page types tracked during body rendering. */
export type PageType = 'recipe' | 'divider' | 'appendix';

/**
 * Pure decision function: should a page header (chapter name + recipe title)
 * be stamped on a page of the given type?
 *
 * - recipe → true (headers show chapter + recipe title)
 * - divider → false
 * - appendix → false
 */
export function shouldStampHeader(type: PageType): boolean {
  return type === 'recipe';
}

/**
 * Pure decision function: should a page footer (centered page number)
 * be stamped on a page of the given type?
 *
 * - recipe → true
 * - appendix → true (page numbers but no header)
 * - divider → false
 */
export function shouldStampFooter(type: PageType): boolean {
  return type === 'recipe' || type === 'appendix';
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

// ─── TOC Page Number Offset ───────────────────────────────────────────────────

/**
 * Computes the displayed page number for a TOC entry.
 * Exported as a pure function for property-based testing.
 *
 * @param bodyPageIndex - The 0-based page index in the body PDF
 * @param tocPageCount - The number of TOC pages that precede the body
 * @returns The 1-based displayed page number in the final merged document
 */
export function computeDisplayedPageNumber(bodyPageIndex: number, tocPageCount: number): number {
  return bodyPageIndex + tocPageCount + 1;
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
   * @returns The number of TOC pages rendered (0 if skipped).
   */
  private async renderToc(
    entries: RecipePageEntry[],
    layout: PageDimensions,
    outputPath: string,
  ): Promise<number> {
    // Req 5.8: Skip TOC entirely if zero recipes
    if (entries.length === 0) {
      return 0;
    }

    // Build grouped TOC lines: chapter headings + recipe titles
    // Each line is either a chapter heading or a recipe entry
    const tocLines = this.buildTocLines(entries);

    // Req 5.1: Max 40 entries per page
    const maxEntriesPerPage = 40;
    const tocPageCount = Math.ceil(tocLines.length / maxEntriesPerPage);

    // Render the TOC PDF
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

    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    // Render TOC pages
    for (let page = 0; page < tocPageCount; page++) {
      doc.addPage();

      const startIdx = page * maxEntriesPerPage;
      const endIdx = Math.min(startIdx + maxEntriesPerPage, tocLines.length);
      const pageLines = tocLines.slice(startIdx, endIdx);

      let y = layout.marginTop;

      for (const line of pageLines) {
        if (line.type === 'chapter') {
          // Req 5.2: Chapter headings flush-left
          doc.font(HEADING_FONT).fontSize(SECTION_HEADING_FONT_SIZE);
          doc.text(line.text, layout.marginLeft, y, { lineBreak: false });
          y += SECTION_HEADING_FONT_SIZE * 1.4;
        } else {
          // Req 5.2: Recipe titles indented 18pt
          const indent = 18;
          const titleX = layout.marginLeft + indent;

          doc.font(BODY_FONT).fontSize(BODY_FONT_SIZE);

          // Req 5.3: Truncate titles > 70 chars with ellipsis
          const displayTitle = line.text.length > 70
            ? line.text.slice(0, 67) + '...'
            : line.text;

          // Req 5.3: Offset page numbers by TOC page count
          const displayPageNumber = String(computeDisplayedPageNumber(line.pageNumber!, tocPageCount));

          // Measure widths for dot leaders
          const titleWidth = doc.widthOfString(displayTitle);
          const pageNumWidth = doc.widthOfString(displayPageNumber);
          const availableWidth = layout.contentWidth - indent;
          const dotWidth = doc.widthOfString('.');

          // Calculate space for dot leaders
          const gapForDots = availableWidth - titleWidth - pageNumWidth - dotWidth * 2;
          const dotCount = Math.max(0, Math.floor(gapForDots / dotWidth));
          const dots = '.'.repeat(dotCount);

          // Render: title + dot leaders + page number
          doc.text(displayTitle, titleX, y, { lineBreak: false, continued: false });

          // Render dots
          if (dotCount > 0) {
            const dotsX = titleX + titleWidth + dotWidth;
            doc.text(dots, dotsX, y, { lineBreak: false, continued: false });
          }

          // Right-align page number
          const pageNumX = layout.marginLeft + layout.contentWidth - pageNumWidth;
          doc.text(displayPageNumber, pageNumX, y, { lineBreak: false, continued: false });

          y += BODY_FONT_SIZE * 1.4;
        }
      }
    }

    doc.end();

    // Wait for write to finish
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    return tocPageCount;
  }

  /**
   * Builds the flat list of TOC lines from recipe page entries.
   * Groups entries under chapter headings, omitting empty chapters.
   * Does NOT include recipeNumber values (Req 5.6).
   */
  private buildTocLines(
    entries: RecipePageEntry[],
  ): Array<{ type: 'chapter'; text: string } | { type: 'recipe'; text: string; pageNumber: number }> {
    const lines: Array<{ type: 'chapter'; text: string } | { type: 'recipe'; text: string; pageNumber: number }> = [];
    let currentChapter: string | null = null;

    for (const entry of entries) {
      // Req 5.7: Omit empty chapters — only emit heading when we have a recipe for it
      if (entry.chapter !== currentChapter) {
        currentChapter = entry.chapter;
        lines.push({ type: 'chapter', text: entry.chapter });
      }
      // Req 5.6: No recipeNumber values — only title and page number
      lines.push({ type: 'recipe', text: entry.title, pageNumber: entry.pageNumber });
    }

    return lines;
  }

  // ─── PDF Merging ──────────────────────────────────────────────────────────

  /**
   * Merges toc.pdf + body.pdf into the final output PDF using pdf-lib.
   * If the TOC file does not exist (0 entries → no TOC rendered), copies
   * the body PDF directly to the output path.
   */
  private async mergeDocuments(
    tocPath: string,
    bodyPath: string,
    outputPath: string,
  ): Promise<void> {
    // Check if TOC was produced (file exists)
    const tocExists = await access(tocPath).then(() => true, () => false);

    if (!tocExists) {
      // No TOC pages — just copy body to output
      await copyFile(bodyPath, outputPath);
      return;
    }

    // Load both PDFs
    const [tocBytes, bodyBytes] = await Promise.all([
      readFile(tocPath),
      readFile(bodyPath),
    ]);

    const tocDoc = await PDFLibDocument.load(tocBytes);
    const bodyDoc = await PDFLibDocument.load(bodyBytes);

    // Create merged document: TOC pages first, then body pages
    const mergedDoc = await PDFLibDocument.create();

    const tocPages = await mergedDoc.copyPages(tocDoc, tocDoc.getPageIndices());
    for (const page of tocPages) {
      mergedDoc.addPage(page);
    }

    const bodyPages = await mergedDoc.copyPages(bodyDoc, bodyDoc.getPageIndices());
    for (const page of bodyPages) {
      mergedDoc.addPage(page);
    }

    // Save merged PDF with valid cross-reference tables
    const mergedBytes = await mergedDoc.save();
    await writeFile(outputPath, mergedBytes);
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
   *
   * Layout: 10pt bold source headings, 9pt body text for recipe titles,
   * 6pt spacing between entries.
   */
  private renderSourceAppendix(
    doc: PDFKit.PDFDocument,
    chapters: ChapterGroup[],
    layout: PageDimensions,
  ): void {
    // Flatten all recipes from all chapters
    const allRecipes: Recipe[] = [];
    for (const chapter of chapters) {
      for (const recipe of chapter.recipes) {
        allRecipes.push(recipe);
      }
    }

    if (allRecipes.length === 0) return;

    // Group recipes by source (empty/blank → "Unknown Source")
    const sourceMap = new Map<string, Recipe[]>();
    for (const recipe of allRecipes) {
      const rawSource = recipe.source.trim();
      const source = rawSource === '' ? 'Unknown Source' : rawSource;
      const existing = sourceMap.get(source);
      if (existing) {
        existing.push(recipe);
      } else {
        sourceMap.set(source, [recipe]);
      }
    }

    // Build sorted groups: alphabetical by source name, recipes alphabetical by title
    const groups: Array<{ source: string; recipes: Recipe[] }> = [];
    for (const [source, groupRecipes] of sourceMap) {
      groupRecipes.sort((a, b) =>
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
      );
      groups.push({ source, recipes: groupRecipes });
    }
    groups.sort((a, b) =>
      a.source.toLowerCase().localeCompare(b.source.toLowerCase()),
    );

    // Constants for compact layout
    const SOURCE_HEADING_FONT_SIZE = 10;
    const APPENDIX_BODY_FONT_SIZE = 9;
    const APPENDIX_ITEM_SPACING = 6;
    const APPENDIX_TITLE_FONT_SIZE = 18;

    // Start a new page for the appendix
    doc.addPage();

    // Render "Sources" as a section title at the top
    doc.font(HEADING_FONT).fontSize(APPENDIX_TITLE_FONT_SIZE);
    doc.text('Sources', layout.marginLeft, layout.marginTop, {
      width: layout.contentWidth,
    });
    doc.y += 12; // Space after title

    // Render each source group
    for (const group of groups) {
      // Check if source heading fits on current page
      doc.font(HEADING_FONT).fontSize(SOURCE_HEADING_FONT_SIZE);
      const headingHeight = doc.heightOfString(group.source, { width: layout.contentWidth });
      const remaining = layout.height - layout.marginBottom - doc.y;

      if (remaining < headingHeight + APPENDIX_BODY_FONT_SIZE * 1.5) {
        // Not enough space for heading + at least one recipe title
        doc.addPage();
      }

      // Render source heading (10pt bold)
      doc.font(HEADING_FONT).fontSize(SOURCE_HEADING_FONT_SIZE);
      doc.text(group.source, layout.marginLeft, doc.y, { width: layout.contentWidth });
      doc.y += APPENDIX_ITEM_SPACING;

      // Render recipe titles (9pt body text, 6pt spacing)
      doc.font(BODY_FONT).fontSize(APPENDIX_BODY_FONT_SIZE);
      for (let i = 0; i < group.recipes.length; i++) {
        const title = group.recipes[i].title;

        // Check overflow before rendering
        const titleHeight = doc.heightOfString(title, { width: layout.contentWidth });
        const spaceLeft = layout.height - layout.marginBottom - doc.y;

        if (spaceLeft < titleHeight) {
          doc.addPage();
          doc.font(BODY_FONT).fontSize(APPENDIX_BODY_FONT_SIZE);
        }

        doc.text(title, layout.marginLeft, doc.y, { width: layout.contentWidth });

        if (i < group.recipes.length - 1) {
          doc.y += APPENDIX_ITEM_SPACING;
        }
      }

      // Space between source groups
      doc.y += APPENDIX_ITEM_SPACING * 2;
    }
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
   * Appendix pages receive page numbers but no header text.
   *
   * Reqs: 12.1, 12.2, 12.3, 12.4, 12.5, 10.4
   */
  private async stampHeaders(
    outputPath: string,
    pageOwnership: PageOwnership[],
    tocPageCount: number,
    layout: PageDimensions,
  ): Promise<void> {
    const pdfBytes = await readFile(outputPath);
    const pdfDoc = await PDFLibDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const fontSize = 8;
    const footerColor = rgb(0.4, 0.4, 0.4);

    // Header Y position: in the top margin, above content area
    const headerY = layout.height - layout.marginTop + 20;
    // Footer Y position: in the bottom margin, below content area
    const footerY = layout.marginBottom - 20;

    for (let i = 0; i < pageOwnership.length; i++) {
      const ownership = pageOwnership[i];

      // Skip divider pages (no headers or footers) — Req 12.2
      if (ownership.type === 'divider') {
        continue;
      }

      // Calculate actual page index in the merged PDF (TOC pages come first)
      const mergedPageIndex = tocPageCount + ownership.pageIndex;
      if (mergedPageIndex >= pages.length) continue;

      const page = pages[mergedPageIndex];

      // Page number: 1-based starting from first body page — Req 12.3, 10.4
      const pageNumber = ownership.pageIndex + 1;

      // Stamp header only on recipe pages (not appendix) — Req 12.1
      if (ownership.type === 'recipe') {
        // Truncate header elements > 50 chars with ellipsis — Req 12.4
        const chapterText = this.truncateHeaderText(ownership.chapter, 50);
        const recipeTitleText = this.truncateHeaderText(ownership.recipeTitle, 50);

        // Left-aligned chapter name
        page.drawText(chapterText, {
          x: layout.marginLeft,
          y: headerY,
          size: fontSize,
          font,
          color: footerColor,
        });

        // Right-aligned recipe title
        const titleWidth = font.widthOfTextAtSize(recipeTitleText, fontSize);
        page.drawText(recipeTitleText, {
          x: layout.width - layout.marginRight - titleWidth,
          y: headerY,
          size: fontSize,
          font,
          color: footerColor,
        });
      }

      // Stamp centered page number in footer — Req 10.4, 12.3
      const pageNumText = String(pageNumber);
      const pageNumWidth = font.widthOfTextAtSize(pageNumText, fontSize);
      const centerX = (layout.width - pageNumWidth) / 2;

      page.drawText(pageNumText, {
        x: centerX,
        y: footerY,
        size: fontSize,
        font,
        color: footerColor,
      });
    }

    // Write updated PDF back
    const updatedBytes = await pdfDoc.save();
    await writeFile(outputPath, updatedBytes);
  }

  /**
   * Truncates text to maxLength characters with ellipsis if it exceeds the limit.
   */
  private truncateHeaderText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }
}
