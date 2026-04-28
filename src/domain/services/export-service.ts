import type { DataStore } from '../ports/data-store-port.js';
import type { PdfRendererPort } from '../ports/pdf-renderer-port.js';
import type { MarkdownRendererPort } from '../ports/markdown-renderer-port.js';
import { HeirloomError } from '../../shared/errors.js';

export type ExportFormat = 'pdf' | 'obsidian';

export interface ExportResult {
  recipeCount: number;
  outputPath: string;
  warnings: string[];
}

export class ExportService {
  constructor(
    private readonly dataStore: DataStore,
    private readonly pdfRenderer: PdfRendererPort,
    private readonly markdownRenderer: MarkdownRendererPort,
  ) {}

  /**
   * Export recipes for a job in the specified format.
   *
   * Retrieves the job status and recipes from the DataStore, validates
   * preconditions, sorts recipes by recipeNumber, and delegates to the
   * appropriate renderer.
   */
  async export(jobName: string, format: ExportFormat, outputPath: string): Promise<ExportResult> {
    const warnings: string[] = [];

    // Retrieve job status — error if job not found
    const status = await this.dataStore.getJobStatus(jobName);
    if (status === undefined) {
      throw new HeirloomError(`Job '${jobName}' not found`);
    }

    // Warn if job has not completed transcription
    if (status !== 'transcribed') {
      warnings.push(`Job '${jobName}' has status '${status}' — export may be incomplete`);
    }

    // Retrieve recipes — error if none found
    const recipes = await this.dataStore.getRecipesByJob(jobName);
    if (recipes.length === 0) {
      throw new HeirloomError(`No recipes found for job '${jobName}'`);
    }

    // Sort by recipeNumber ascending (lexicographic)
    recipes.sort((a, b) => a.recipeNumber.localeCompare(b.recipeNumber));

    // Delegate to the appropriate renderer
    if (format === 'pdf') {
      await this.pdfRenderer.render(recipes, outputPath);
    } else {
      await this.markdownRenderer.renderVault(recipes, outputPath);
    }

    return {
      recipeCount: recipes.length,
      outputPath,
      warnings,
    };
  }
}
