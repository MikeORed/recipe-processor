import type { DataStore } from '../ports/data-store-port.js';
import type { PdfRendererPort, ChapterGroup, PdfRenderOptions } from '../ports/pdf-renderer-port.js';
import type { MarkdownRendererPort } from '../ports/markdown-renderer-port.js';
import type { Recipe } from '../models/recipe.js';
import { HeirloomError } from '../../shared/errors.js';

/**
 * Canonical category order for chapter grouping.
 * Exported for use in property-based tests.
 */
export const CANONICAL_CATEGORY_ORDER: readonly string[] = [
  'Appetizers & Snacks',
  'Soups & Stews',
  'Salads & Dressings',
  'Beef & Pork',
  'Poultry',
  'Seafood',
  'Pasta & Rice',
  'Sides & Vegetables',
  'Breads',
  'Cakes',
  'Pies & Pastries',
  'Cookies & Bars',
  'Beverages',
  'Sauces & Condiments',
] as const;

/** Default PdfRenderOptions used when the caller does not supply them. */
const DEFAULT_PDF_OPTIONS: PdfRenderOptions = {
  imageMode: 'thumbnail',
  pageSize: 'letter',
  multiPerPage: true,
  confidenceMarkers: true,
  chapterGrouping: true,
};

export type ExportFormat = 'pdf' | 'obsidian';

export interface ExportResult {
  recipeCount: number;
  outputPath: string;
  warnings: string[];
}

/**
 * Groups recipes by category in canonical order, mapping "uncategorized" to "Odds & Ends".
 * Empty chapters are omitted. Recipes within each chapter are sorted alphabetically
 * by title (case-insensitive).
 *
 * Exported for direct testing by property-based tests.
 */
export function groupRecipesByCategory(recipes: Recipe[]): ChapterGroup[] {
  // Build a map of category → recipes
  const categoryMap = new Map<string, Recipe[]>();

  for (const recipe of recipes) {
    const category = recipe.category;
    const existing = categoryMap.get(category);
    if (existing) {
      existing.push(recipe);
    } else {
      categoryMap.set(category, [recipe]);
    }
  }

  const chapters: ChapterGroup[] = [];

  // Process canonical categories in order
  for (const category of CANONICAL_CATEGORY_ORDER) {
    const categoryRecipes = categoryMap.get(category);
    if (categoryRecipes && categoryRecipes.length > 0) {
      categoryRecipes.sort((a, b) =>
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
      );
      chapters.push({ chapter: category, recipes: categoryRecipes });
    }
  }

  // Process "uncategorized" last, mapped to "Odds & Ends"
  const uncategorized = categoryMap.get('uncategorized');
  if (uncategorized && uncategorized.length > 0) {
    uncategorized.sort((a, b) =>
      a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
    );
    chapters.push({ chapter: 'Odds & Ends', recipes: uncategorized });
  }

  return chapters;
}

export interface SourceGroup {
  source: string;
  recipes: Recipe[];
}

/**
 * Groups recipes by their `source` field for the source appendix.
 * - Empty/blank source values are mapped to "Unknown Source"
 * - Groups are sorted alphabetically by source name (case-insensitive)
 * - Recipes within each group are sorted alphabetically by title (case-insensitive)
 *
 * Exported for direct testing by property-based tests.
 */
export function groupRecipesBySource(recipes: Recipe[]): SourceGroup[] {
  const sourceMap = new Map<string, Recipe[]>();

  for (const recipe of recipes) {
    const rawSource = recipe.source.trim();
    const source = rawSource === '' ? 'Unknown Source' : rawSource;
    const existing = sourceMap.get(source);
    if (existing) {
      existing.push(recipe);
    } else {
      sourceMap.set(source, [recipe]);
    }
  }

  const groups: SourceGroup[] = [];
  for (const [source, groupRecipes] of sourceMap) {
    groupRecipes.sort((a, b) =>
      a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
    );
    groups.push({ source, recipes: groupRecipes });
  }

  groups.sort((a, b) =>
    a.source.toLowerCase().localeCompare(b.source.toLowerCase()),
  );

  return groups;
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
   * preconditions, groups/sorts recipes, and delegates to the appropriate renderer.
   */
  async export(
    jobName: string,
    format: ExportFormat,
    outputPath: string,
    options: PdfRenderOptions = DEFAULT_PDF_OPTIONS,
  ): Promise<ExportResult> {
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

    // Delegate to the appropriate renderer
    if (format === 'pdf') {
      let chapters: ChapterGroup[];

      if (options.chapterGrouping) {
        chapters = groupRecipesByCategory(recipes);
      } else {
        // Flat mode: single group sorted alphabetically by title (case-insensitive)
        const sorted = [...recipes].sort((a, b) =>
          a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
        );
        chapters = [{ chapter: 'All Recipes', recipes: sorted }];
      }

      await this.pdfRenderer.render(chapters, options, outputPath);
    } else {
      // Obsidian format — sort by recipeNumber for stable vault output
      recipes.sort((a, b) => a.recipeNumber.localeCompare(b.recipeNumber));
      await this.markdownRenderer.renderVault(recipes, outputPath);
    }

    return {
      recipeCount: recipes.length,
      outputPath,
      warnings,
    };
  }
}
