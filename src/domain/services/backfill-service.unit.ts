import { BackfillService } from './backfill-service.js';
import type { BackfillResult } from './backfill-service.js';
import type { DataStore } from '../ports/data-store-port.js';
import type { StructureExtractor, ExtractionInput } from '../ports/structure-extractor-port.js';
import type { Recipe } from '../models/index.js';
import { HeirloomError } from '../../shared/errors.js';

// --- Helpers ---

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    jobName: 'test-job',
    recipeNumber: '1',
    source: 'grandma-book',
    title: 'Test Recipe',
    author: null,
    year: null,
    category: 'Soups & Stews',
    cuisine: null,
    tags: [],
    ingredients: ['1 cup flour'],
    instructions: ['Mix well'],
    notes: [],
    imageKeys: ['test-job/img1.jpg'],
    confidence: { title: 0.9, ingredients: 0.9, instructions: 0.9, notes: 0.9 },
    ...overrides,
  };
}

function mockDataStore(overrides: Partial<DataStore> = {}): DataStore {
  return {
    putRecipe: jest.fn().mockResolvedValue(undefined),
    getRecipesByJob: jest.fn().mockResolvedValue([]),
    getRecipeWithOcr: jest.fn().mockResolvedValue({ recipe: makeRecipe(), ocrText: 'some ocr text' }),
    updateJobStatus: jest.fn().mockResolvedValue(undefined),
    getJobStatus: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockExtractor(extractFn?: (input: ExtractionInput) => Promise<Recipe[]>): StructureExtractor {
  const defaultFn = jest.fn().mockImplementation(async (input: ExtractionInput) => [
    makeRecipe({ recipeNumber: input.recipeNumber, category: 'Beef & Pork', cuisine: 'American' }),
  ]);
  return {
    extract: extractFn ? jest.fn(extractFn) : defaultFn,
  };
}

// --- Tests ---

describe('BackfillService', () => {
  describe('backfill', () => {
    it('processes all recipes successfully', async () => {
      const recipes = [
        makeRecipe({ recipeNumber: '1' }),
        makeRecipe({ recipeNumber: '2' }),
        makeRecipe({ recipeNumber: '3' }),
      ];

      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue(recipes),
      });
      const extractor = mockExtractor();
      const service = new BackfillService(dataStore, extractor);

      const result = await service.backfill('test-job', 5);

      expect(result).toEqual<BackfillResult>({
        totalProcessed: 3,
        successCount: 3,
        failedCount: 0,
        failures: [],
      });

      expect(dataStore.putRecipe).toHaveBeenCalledTimes(3);
      // Verify identity fields are preserved in put calls
      const putCalls = (dataStore.putRecipe as jest.Mock).mock.calls;
      expect(putCalls[0][0]).toMatchObject({ jobName: 'test-job', recipeNumber: '1', source: 'grandma-book' });
      expect(putCalls[1][0]).toMatchObject({ jobName: 'test-job', recipeNumber: '2', source: 'grandma-book' });
      expect(putCalls[2][0]).toMatchObject({ jobName: 'test-job', recipeNumber: '3', source: 'grandma-book' });
    });

    it('respects bounded concurrency limit', async () => {
      const recipes = Array.from({ length: 5 }, (_, i) =>
        makeRecipe({ recipeNumber: String(i + 1) }),
      );

      let activeConcurrent = 0;
      let maxConcurrent = 0;

      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue(recipes),
      });

      const extractor = mockExtractor(async (input: ExtractionInput) => {
        activeConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, activeConcurrent);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeConcurrent--;
        return [makeRecipe({ recipeNumber: input.recipeNumber, category: 'Beef & Pork' })];
      });

      const service = new BackfillService(dataStore, extractor);
      await service.backfill('test-job', 2);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(maxConcurrent).toBeGreaterThanOrEqual(1);
      // All 5 should still be processed
      expect(dataStore.putRecipe).toHaveBeenCalledTimes(5);
    });

    it('continues processing after individual recipe failures', async () => {
      const recipes = [
        makeRecipe({ recipeNumber: '1' }),
        makeRecipe({ recipeNumber: '2' }),
        makeRecipe({ recipeNumber: '3' }),
      ];

      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue(recipes),
      });

      const extractor = mockExtractor(async (input: ExtractionInput) => {
        if (input.recipeNumber === '2') {
          throw new Error('Extraction failed for recipe 2');
        }
        return [makeRecipe({ recipeNumber: input.recipeNumber, category: 'Beef & Pork' })];
      });

      const service = new BackfillService(dataStore, extractor);
      const result = await service.backfill('test-job', 5);

      expect(result.totalProcessed).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.failures).toEqual([
        { recipeNumber: '2', error: 'Extraction failed for recipe 2' },
      ]);

      // Verify successful recipes get extracted data
      const putCalls = (dataStore.putRecipe as jest.Mock).mock.calls;
      // Should have 3 putRecipe calls: 2 successful extractions + 1 fallback patch
      expect(putCalls).toHaveLength(3);

      // The failed recipe should be patched with fallback values
      const failedPut = putCalls.find(
        (call: [Recipe]) => call[0].recipeNumber === '2',
      );
      expect(failedPut).toBeDefined();
      expect(failedPut![0].category).toBe('uncategorized');
      expect(failedPut![0].cuisine).toBeNull();
    });

    it('retries on ThrottlingException with backoff', async () => {
      jest.useFakeTimers();

      const recipes = [makeRecipe({ recipeNumber: '1' })];
      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue(recipes),
      });

      let callCount = 0;
      const extractor = mockExtractor(async (input: ExtractionInput) => {
        callCount++;
        if (callCount <= 2) {
          const err = new Error('ThrottlingException: Rate exceeded');
          err.name = 'ThrottlingException';
          throw err;
        }
        return [makeRecipe({ recipeNumber: input.recipeNumber, category: 'Poultry' })];
      });

      // Make Math.random deterministic for predictable delays
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const service = new BackfillService(dataStore, extractor);
      const resultPromise = service.backfill('test-job', 5);

      // Advance past first retry delay: base=1000 * 2^0 = 1000, jitter=0.5*1000=500, total=1500
      await jest.advanceTimersByTimeAsync(1500);
      // Advance past second retry delay: base=1000 * 2^1 = 2000, jitter=0.5*2000=1000, total=3000
      await jest.advanceTimersByTimeAsync(3000);

      const result = await resultPromise;

      expect(callCount).toBe(3);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(0);

      jest.useRealTimers();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('fails after max retries on ThrottlingException', async () => {
      jest.useFakeTimers();

      const recipes = [makeRecipe({ recipeNumber: '1' })];
      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue(recipes),
      });

      const extractor = mockExtractor(async () => {
        const err = new Error('ThrottlingException: Rate exceeded');
        err.name = 'ThrottlingException';
        throw err;
      });

      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const service = new BackfillService(dataStore, extractor);
      const resultPromise = service.backfill('test-job', 5);

      // MAX_RETRIES = 3, so 4 total attempts with 3 delays
      // Delay 0: 1000*2^0 + 0.5*1000 = 1500
      await jest.advanceTimersByTimeAsync(1500);
      // Delay 1: 1000*2^1 + 0.5*2000 = 3000
      await jest.advanceTimersByTimeAsync(3000);
      // Delay 2: 1000*2^2 + 0.5*4000 = 6000
      await jest.advanceTimersByTimeAsync(6000);

      const result = await resultPromise;

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.failures[0].recipeNumber).toBe('1');
      expect(result.failures[0].error).toContain('ThrottlingException');

      // Failed recipe should be patched with fallback
      const putCalls = (dataStore.putRecipe as jest.Mock).mock.calls;
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0][0].category).toBe('uncategorized');
      expect(putCalls[0][0].cuisine).toBeNull();

      jest.useRealTimers();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('does not retry non-throttling errors', async () => {
      const recipes = [makeRecipe({ recipeNumber: '1' })];
      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue(recipes),
      });

      let callCount = 0;
      const extractor = mockExtractor(async () => {
        callCount++;
        throw new Error('ValidationError: Invalid input');
      });

      const service = new BackfillService(dataStore, extractor);
      const result = await service.backfill('test-job', 5);

      // Should fail immediately without retries
      expect(callCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.failures[0].error).toContain('ValidationError');
    });

    it('throws HeirloomError for empty job', async () => {
      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue([]),
      });
      const extractor = mockExtractor();
      const service = new BackfillService(dataStore, extractor);

      await expect(service.backfill('empty-job', 5)).rejects.toThrow(HeirloomError);
      await expect(service.backfill('empty-job', 5)).rejects.toThrow(
        'No recipes found for job "empty-job"',
      );
    });

    it('handles missing OCR text', async () => {
      const recipes = [makeRecipe({ recipeNumber: '1' })];
      const dataStore = mockDataStore({
        getRecipesByJob: jest.fn().mockResolvedValue(recipes),
        getRecipeWithOcr: jest.fn().mockResolvedValue(undefined),
      });
      const extractor = mockExtractor();
      const service = new BackfillService(dataStore, extractor);

      const result = await service.backfill('test-job', 5);

      expect(result.failedCount).toBe(1);
      expect(result.failures[0].recipeNumber).toBe('1');
      expect(result.failures[0].error).toContain('No OCR text found');

      // Should still patch with fallback values
      const putCalls = (dataStore.putRecipe as jest.Mock).mock.calls;
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0][0].category).toBe('uncategorized');
      expect(putCalls[0][0].cuisine).toBeNull();
    });
  });
});
