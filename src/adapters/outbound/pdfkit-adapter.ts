import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import PDFDocument from 'pdfkit';

import type { PdfRendererPort } from '../../domain/ports/pdf-renderer-port.js';
import type { Recipe } from '../../domain/models/recipe.js';

/** Confidence threshold below which a field is flagged for review. */
const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Outbound adapter that implements PdfRendererPort using the pdfkit library.
 *
 * Generates a print-ready PDF cookbook with a table of contents, per-recipe
 * sections, review markers for low-confidence fields, and image key references.
 */
export class PdfKitAdapter implements PdfRendererPort {
  async render(recipes: Recipe[], outputPath: string): Promise<void> {
    // Ensure the output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    const doc = new PDFDocument({ autoFirstPage: true, bufferPages: true });

    // Pipe to file — wrap in a promise so we can await completion
    const stream = createWriteStream(outputPath);
    const finished = new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    doc.pipe(stream);

    // --- Table of Contents ---
    this.renderTableOfContents(doc, recipes);

    // --- Recipe Sections ---
    for (const recipe of recipes) {
      doc.addPage();
      this.renderRecipeSection(doc, recipe);
    }

    doc.end();
    await finished;
  }

  private renderTableOfContents(doc: PDFKit.PDFDocument, recipes: Recipe[]): void {
    doc.fontSize(24).text('Table of Contents', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12);
    for (const recipe of recipes) {
      doc.text(`${recipe.recipeNumber}. ${recipe.title}`);
    }
  }

  private renderRecipeSection(doc: PDFKit.PDFDocument, recipe: Recipe): void {
    const hasLowConfidence = (field: keyof Recipe['confidence']): boolean =>
      recipe.confidence[field] < LOW_CONFIDENCE_THRESHOLD;

    // Title
    const titleMarker = hasLowConfidence('title') ? ' ⚠️' : '';
    doc.fontSize(20).text(`${recipe.recipeNumber}. ${recipe.title}${titleMarker}`);
    doc.moveDown(0.5);

    // Source
    if (recipe.source) {
      doc.fontSize(10).text(`Source: ${recipe.source}`);
      doc.moveDown(0.5);
    }

    // Ingredients
    doc.fontSize(14).text(`Ingredients${hasLowConfidence('ingredients') ? ' ⚠️' : ''}`);
    doc.fontSize(10);
    for (const ingredient of recipe.ingredients) {
      doc.text(`  • ${ingredient}`);
    }
    doc.moveDown(0.5);

    // Instructions
    doc.fontSize(14).text(`Instructions${hasLowConfidence('instructions') ? ' ⚠️' : ''}`);
    doc.fontSize(10);
    for (let i = 0; i < recipe.instructions.length; i++) {
      doc.text(`  ${i + 1}. ${recipe.instructions[i]}`);
    }
    doc.moveDown(0.5);

    // Notes
    if (recipe.notes) {
      doc.fontSize(14).text(`Notes${hasLowConfidence('notes') ? ' ⚠️' : ''}`);
      doc.fontSize(10).text(recipe.notes);
      doc.moveDown(0.5);
    }

    // Image key references
    if (recipe.imageKeys.length > 0) {
      doc.fontSize(8).fillColor('gray').text(`Images: ${recipe.imageKeys.join(', ')}`);
      doc.fillColor('black');
    }
  }
}
