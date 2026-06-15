import type { DataStore } from '../ports/data-store-port.js';
import type { StructureExtractor } from '../ports/structure-extractor-port.js';
import type { Recipe } from '../models/index.js';
import { HeirloomError } from '../../shared/errors.js';

export interface BackfillResult {
  totalProcessed: number;
  successCount: number;
  failedCount: number;
  failures: Array<{ recipeNumber: string; error: string }>;
}

/**
 * Re-processes all recipes for a job through the structure extractor,
 * updating records with enriched category/cuisine fields.
 */
export class BackfillService {
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;

  constructor(
    private readonly dataStore: DataStore,
    private readonly extractor: StructureExtractor,
  ) {}

  async backfill(jobName: string, concurrency: number): Promise<BackfillResult> {
    const recipes = await this.dataStore.getRecipesByJob(jobName);

    if (recipes.length === 0) {
      throw new HeirloomError(`No recipes found for job "${jobName}" — nothing to backfill.`);
    }

    const failures: Array<{ recipeNumber: string; error: string }> = [];
    let successCount = 0;

    const tasks = recipes.map((recipe) => () => this.processRecipe(recipe));
    const results = await this.runWithConcurrency(tasks, concurrency);

    for (const result of results) {
      if (result.success) {
        successCount++;
      } else {
        failures.push({ recipeNumber: result.recipeNumber, error: result.error! });
      }
    }

    return {
      totalProcessed: recipes.length,
      successCount,
      failedCount: failures.length,
      failures,
    };
  }

  private async processRecipe(
    recipe: Recipe,
  ): Promise<{ recipeNumber: string; success: boolean; error?: string }> {
    const { jobName, recipeNumber, source, imageKeys } = recipe;

    try {
      // Retrieve persisted OCR text for this recipe
      const record = await this.dataStore.getRecipeWithOcr(jobName, recipeNumber);
      if (!record) {
        throw new HeirloomError(
          `No OCR text found for recipe ${recipeNumber} in job "${jobName}"`,
        );
      }

      // Re-submit OCR text through the extractor with retry logic
      const extracted = await this.extractWithRetry({
        ocrText: record.ocrText,
        recipeNumber,
        source,
        jobName,
        imageKeys,
      });

      // Persist the re-extracted recipe(s), preserving identity fields
      for (const newRecipe of extracted) {
        await this.dataStore.putRecipe({
          ...newRecipe,
          jobName,
          recipeNumber,
          source,
          imageKeys,
        });
      }

      return { recipeNumber, success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[BackfillService] Failed to process recipe ${recipeNumber}: ${message}`,
      );

      // Patch record with fallback values
      try {
        await this.dataStore.putRecipe({
          ...recipe,
          category: 'uncategorized',
          cuisine: null,
        });
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr);
        console.error(
          `[BackfillService] Failed to patch recipe ${recipeNumber}: ${patchMsg}`,
        );
      }

      return { recipeNumber, success: false, error: message };
    }
  }

  private async extractWithRetry(input: {
    ocrText: string;
    recipeNumber: string;
    source: string;
    jobName: string;
    imageKeys: string[];
  }): Promise<Recipe[]> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= BackfillService.MAX_RETRIES; attempt++) {
      try {
        return await this.extractor.extract(input);
      } catch (err) {
        if (this.isThrottlingError(err) && attempt < BackfillService.MAX_RETRIES) {
          lastError = err;
          const delay = this.computeBackoffDelay(attempt);
          await this.sleep(delay);
        } else {
          throw err;
        }
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError;
  }

  private isThrottlingError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const name = err.name ?? '';
    const message = err.message ?? '';
    return (
      name.includes('Throttling') ||
      name.includes('ThrottlingException') ||
      message.includes('ThrottlingException') ||
      message.includes('Throttling')
    );
  }

  private computeBackoffDelay(attempt: number): number {
    const exponentialDelay = BackfillService.BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * exponentialDelay;
    return exponentialDelay + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Simple inline semaphore pattern for bounded concurrency.
   * Avoids external dependencies in the domain layer.
   */
  private async runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number,
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < tasks.length) {
        const currentIndex = index++;
        results[currentIndex] = await tasks[currentIndex]();
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, tasks.length) },
      () => worker(),
    );

    await Promise.all(workers);
    return results;
  }
}
