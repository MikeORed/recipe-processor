import fc from 'fast-check';
import type { Recipe } from '../models/recipe.js';
import { ExportService, groupRecipesBySource } from './export-service.js';
import type { DataStore } from '../ports/data-store-port.js';
import type { PdfRendererPort, ChapterGroup, PdfRenderOptions } from '../ports/pdf-renderer-port.js';
import type { MarkdownRendererPort } from '../ports/markdown-renderer-port.js';

// --- Arbitraries ---

/** Arbitrary that produces a valid confidence object. */
const validConfidenceObjArb = fc.record({
  title: fc.double({ min: 0, max: 1, noNaN: true }),
  ingredients: fc.double({ min: 0, max: 1, noNaN: true }),
  instructions: fc.double({ min: 0, max: 1, noNaN: true }),
  notes: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** Arbitrary that produces a non-empty alphanumeric string (for titles, jobNames, etc.). */
const nonEmptyStringArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/);

/** Arbitrary that produces a valid category enum value. */
const categoryArb = fc.constantFrom(
  'Appetizers & Snacks' as const,
  'Soups & Stews' as const,
  'Salads & Dressings' as const,
  'Beef & Pork' as const,
  'Poultry' as const,
  'Seafood' as const,
  'Pasta & Rice' as const,
  'Sides & Vegetables' as const,
  'Breads' as const,
  'Cakes' as const,
  'Pies & Pastries' as const,
  'Cookies & Bars' as const,
  'Beverages' as const,
  'Sauces & Condiments' as const,
  'uncategorized' as const,
);

/** Arbitrary that produces a valid cuisine enum value or null. */
const cuisineArb = fc.oneof(
  fc.constantFrom(
    'American' as const,
    'American Regional' as const,
    'Mexican & Central American' as const,
    'South American' as const,
    'Caribbean' as const,
    'Italian' as const,
    'French' as const,
    'European & Eastern European' as const,
    'Mediterranean' as const,
    'Middle Eastern' as const,
    'African' as const,
    'South Asian' as const,
    'East Asian' as const,
    'Southeast Asian' as const,
    'Other' as const,
  ),
  fc.constant(null),
);

/** Arbitrary that produces a source string (can be non-empty, empty, or whitespace). */
const sourceArb = fc.oneof(
  nonEmptyStringArb,
  fc.constant(''),
  fc.constant(' '),
  fc.constant('  '),
);

/** Arbitrary that produces a valid Recipe object with a controllable source. */
const recipeWithSourceArb = (source: fc.Arbitrary<string>): fc.Arbitrary<Recipe> =>
  fc.record({
    jobName: nonEmptyStringArb,
    recipeNumber: nonEmptyStringArb,
    source,
    title: nonEmptyStringArb,
    author: fc.oneof(nonEmptyStringArb, fc.constant(null)),
    year: fc.oneof(fc.integer({ min: 1900, max: 2030 }), fc.constant(null)),
    category: categoryArb,
    cuisine: cuisineArb,
    tags: fc.array(nonEmptyStringArb, { minLength: 0, maxLength: 3 }),
    ingredients: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
    instructions: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
    notes: fc.array(fc.string(), { minLength: 0, maxLength: 3 }),
    imageKeys: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
    confidence: validConfidenceObjArb,
  }) as fc.Arbitrary<Recipe>;

/** Arbitrary that produces a non-empty array of recipes with varied sources. */
const recipesArb = fc.array(recipeWithSourceArb(sourceArb), { minLength: 1, maxLength: 20 });

// --- Property 6: Source appendix grouping and ordering ---

describe('Feature: pdf-export-improvements, Property 6: Source appendix grouping and ordering', () => {
  it('(a) each source group has a distinct source key', () => {
    /**
     * Validates: Requirements 7.2
     */
    fc.assert(
      fc.property(recipesArb, (recipes) => {
        const groups = groupRecipesBySource(recipes);
        const sourceNames = groups.map((g) => g.source);
        const uniqueNames = new Set(sourceNames);
        expect(sourceNames.length).toBe(uniqueNames.size);
      }),
      { numRuns: 100 },
    );
  });

  it('(b) source groups are ordered alphabetically by source name', () => {
    /**
     * Validates: Requirements 7.4
     */
    fc.assert(
      fc.property(recipesArb, (recipes) => {
        const groups = groupRecipesBySource(recipes);
        for (let i = 1; i < groups.length; i++) {
          const prev = groups[i - 1].source.toLowerCase();
          const curr = groups[i].source.toLowerCase();
          expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('(c) recipes within each source group are sorted alphabetically by title (case-insensitive)', () => {
    /**
     * Validates: Requirements 7.5
     */
    fc.assert(
      fc.property(recipesArb, (recipes) => {
        const groups = groupRecipesBySource(recipes);
        for (const group of groups) {
          for (let i = 1; i < group.recipes.length; i++) {
            const prev = group.recipes[i - 1].title.toLowerCase();
            const curr = group.recipes[i].title.toLowerCase();
            expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('(d) empty string and whitespace-only sources map to "Unknown Source"', () => {
    /**
     * Validates: Requirements 7.2
     */
    const blankSourceArb = fc.constantFrom('', ' ', '  ');
    const blankRecipesArb = fc.array(recipeWithSourceArb(blankSourceArb), {
      minLength: 1,
      maxLength: 10,
    });

    fc.assert(
      fc.property(blankRecipesArb, (recipes) => {
        const groups = groupRecipesBySource(recipes);
        // All recipes with blank sources should end up in "Unknown Source"
        expect(groups.length).toBe(1);
        expect(groups[0].source).toBe('Unknown Source');
        expect(groups[0].recipes.length).toBe(recipes.length);
      }),
      { numRuns: 100 },
    );
  });

  it('(e) every input recipe appears in exactly one source group (completeness, no duplication)', () => {
    /**
     * Validates: Requirements 7.2, 7.4, 7.5
     */
    fc.assert(
      fc.property(recipesArb, (recipes) => {
        const groups = groupRecipesBySource(recipes);

        // Total recipes across all groups equals input count
        const totalInGroups = groups.reduce((sum, g) => sum + g.recipes.length, 0);
        expect(totalInGroups).toBe(recipes.length);

        // Every input recipe appears in exactly one group
        const allGroupedRecipes = groups.flatMap((g) => g.recipes);
        for (const recipe of recipes) {
          const count = allGroupedRecipes.filter(
            (r) => r.recipeNumber === recipe.recipeNumber && r.jobName === recipe.jobName,
          ).length;
          expect(count).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 11: ImageKey path resolution ---

import path from 'node:path';
import { resolveImageKeyPath } from './image-processor.js';

/** Arbitrary that produces a non-empty string without slashes (for jobName and filename parts). */
const noSlashStringArb = fc.stringMatching(/^[a-zA-Z0-9._-]{1,30}$/);

describe('Feature: pdf-export-improvements, Property 11: ImageKey path resolution', () => {
  it('(a) imageKey with slash resolves to jobs/<jobName>/images/<filename>', () => {
    /**
     * Validates: Requirements 11.5
     */
    fc.assert(
      fc.property(noSlashStringArb, noSlashStringArb, (jobName, filename) => {
        const imageKey = `${jobName}/${filename}`;
        const result = resolveImageKeyPath(imageKey, jobName);
        const expected = path.join('jobs', jobName, 'images', filename);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('(b) imageKey without slash uses full string as filename', () => {
    /**
     * Validates: Requirements 11.5
     */
    fc.assert(
      fc.property(noSlashStringArb, noSlashStringArb, (jobName, filename) => {
        // imageKey is just the filename with no slash
        const result = resolveImageKeyPath(filename, jobName);
        const expected = path.join('jobs', jobName, 'images', filename);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 5: Flat mode produces single alphabetically-sorted group ---

/** Arbitrary that produces a valid Recipe with a non-empty title. */
const recipeArb: fc.Arbitrary<Recipe> = fc.record({
  jobName: fc.constant('test-job'),
  recipeNumber: nonEmptyStringArb,
  source: fc.string(),
  title: nonEmptyStringArb,
  author: fc.oneof(nonEmptyStringArb, fc.constant(null)),
  year: fc.oneof(fc.integer({ min: 1900, max: 2030 }), fc.constant(null)),
  category: categoryArb,
  cuisine: cuisineArb,
  tags: fc.array(nonEmptyStringArb, { minLength: 0, maxLength: 3 }),
  ingredients: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
  instructions: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
  notes: fc.array(fc.string(), { minLength: 0, maxLength: 3 }),
  imageKeys: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
  confidence: validConfidenceObjArb,
}) as fc.Arbitrary<Recipe>;

/** Arbitrary that produces a non-empty array of recipes (1 to 20). */
const recipeArrayArb = fc.array(recipeArb, { minLength: 1, maxLength: 20 });

/** Creates a mock DataStore that returns the given recipes for any job. */
function createMockDataStore(recipes: Recipe[]): DataStore {
  return {
    getJobStatus: jest.fn().mockResolvedValue('transcribed'),
    getRecipesByJob: jest.fn().mockResolvedValue(recipes),
    putRecipe: jest.fn().mockResolvedValue(undefined),
    updateJobStatus: jest.fn().mockResolvedValue(undefined),
    getRecipeWithOcr: jest.fn().mockResolvedValue(undefined),
  } as DataStore;
}

/** Creates a mock PdfRendererPort that captures the chapters argument. */
function createCapturingRenderer(): {
  renderer: PdfRendererPort;
  getCaptured: () => ChapterGroup[];
} {
  let captured: ChapterGroup[] = [];
  const renderer: PdfRendererPort = {
    render: jest.fn(async (chapters: ChapterGroup[]) => {
      captured = chapters;
    }),
  };
  return { renderer, getCaptured: () => captured };
}

/** Creates a mock MarkdownRendererPort (not used in PDF tests). */
function createMockMarkdownRenderer(): MarkdownRendererPort {
  return { renderVault: jest.fn().mockResolvedValue(undefined) } as MarkdownRendererPort;
}

/** Options with chapterGrouping disabled (flat mode). */
const FLAT_MODE_OPTIONS: PdfRenderOptions = {
  imageMode: 'thumbnail',
  pageSize: 'letter',
  multiPerPage: true,
  confidenceMarkers: true,
  chapterGrouping: false,
};

describe('Feature: pdf-export-improvements, Property 5: Flat mode produces single alphabetically-sorted group', () => {
  /**
   * Validates: Requirements 6.6, 14.3
   */

  it('(a) produces exactly one chapter group', async () => {
    await fc.assert(
      fc.asyncProperty(recipeArrayArb, async (recipes) => {
        const dataStore = createMockDataStore(recipes);
        const { renderer, getCaptured } = createCapturingRenderer();
        const service = new ExportService(dataStore, renderer, createMockMarkdownRenderer());

        await service.export('test-job', 'pdf', '/tmp/out.pdf', FLAT_MODE_OPTIONS);

        const chapters = getCaptured();
        expect(chapters).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  it('(b) the chapter name is "All Recipes"', async () => {
    await fc.assert(
      fc.asyncProperty(recipeArrayArb, async (recipes) => {
        const dataStore = createMockDataStore(recipes);
        const { renderer, getCaptured } = createCapturingRenderer();
        const service = new ExportService(dataStore, renderer, createMockMarkdownRenderer());

        await service.export('test-job', 'pdf', '/tmp/out.pdf', FLAT_MODE_OPTIONS);

        const chapters = getCaptured();
        expect(chapters[0].chapter).toBe('All Recipes');
      }),
      { numRuns: 100 },
    );
  });

  it('(c) all input recipes appear in the output (completeness)', async () => {
    await fc.assert(
      fc.asyncProperty(recipeArrayArb, async (recipes) => {
        const dataStore = createMockDataStore(recipes);
        const { renderer, getCaptured } = createCapturingRenderer();
        const service = new ExportService(dataStore, renderer, createMockMarkdownRenderer());

        await service.export('test-job', 'pdf', '/tmp/out.pdf', FLAT_MODE_OPTIONS);

        const chapters = getCaptured();
        expect(chapters[0].recipes).toHaveLength(recipes.length);
      }),
      { numRuns: 100 },
    );
  });

  it('(d) recipes are sorted alphabetically by title (case-insensitive)', async () => {
    await fc.assert(
      fc.asyncProperty(recipeArrayArb, async (recipes) => {
        const dataStore = createMockDataStore(recipes);
        const { renderer, getCaptured } = createCapturingRenderer();
        const service = new ExportService(dataStore, renderer, createMockMarkdownRenderer());

        await service.export('test-job', 'pdf', '/tmp/out.pdf', FLAT_MODE_OPTIONS);

        const chapters = getCaptured();
        const titles = chapters[0].recipes.map((r) => r.title);

        for (let i = 0; i < titles.length - 1; i++) {
          const cmp = titles[i].toLowerCase().localeCompare(titles[i + 1].toLowerCase());
          expect(cmp).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('(e) no recipes are lost or duplicated (recipe identities match input set)', async () => {
    await fc.assert(
      fc.asyncProperty(recipeArrayArb, async (recipes) => {
        const dataStore = createMockDataStore(recipes);
        const { renderer, getCaptured } = createCapturingRenderer();
        const service = new ExportService(dataStore, renderer, createMockMarkdownRenderer());

        await service.export('test-job', 'pdf', '/tmp/out.pdf', FLAT_MODE_OPTIONS);

        const chapters = getCaptured();
        const outputRecipeNumbers = chapters[0].recipes
          .map((r) => r.recipeNumber)
          .sort();
        const inputRecipeNumbers = [...recipes]
          .map((r) => r.recipeNumber)
          .sort();

        expect(outputRecipeNumbers).toEqual(inputRecipeNumbers);
      }),
      { numRuns: 100 },
    );
  });
});
