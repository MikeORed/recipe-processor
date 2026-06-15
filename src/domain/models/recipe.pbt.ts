import fc from 'fast-check';
import { recipeSchema, confidenceScoreSchema, categoryEnum, cuisineEnum } from './recipe.js';

// --- Arbitraries ---

/** Arbitrary that produces a valid confidence score in [0, 1]. */
const validConfidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

/** Arbitrary that produces a number strictly greater than 1. */
const aboveOneArb = fc.double({ min: 1.0000001, max: 1e10, noNaN: true });

/** Arbitrary that produces a number strictly less than 0. */
const belowZeroArb = fc.double({ min: -1e10, max: -0.0000001, noNaN: true });

/** Arbitrary that produces a valid confidence object. */
const validConfidenceObjArb = fc.record({
  title: validConfidenceArb,
  ingredients: validConfidenceArb,
  instructions: validConfidenceArb,
  notes: validConfidenceArb,
});

/** Arbitrary that produces a non-empty alphanumeric string. */
const nonEmptyStringArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/);

/** Arbitrary that produces a valid category enum value. */
const categoryArb = fc.constantFrom(
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
  'uncategorized',
);

/** Arbitrary that produces a valid cuisine enum value or null. */
const cuisineArb = fc.oneof(
  fc.constantFrom(
    'American',
    'American Regional',
    'Mexican & Central American',
    'South American',
    'Caribbean',
    'Italian',
    'French',
    'European & Eastern European',
    'Mediterranean',
    'Middle Eastern',
    'African',
    'South Asian',
    'East Asian',
    'Southeast Asian',
    'Other',
  ),
  fc.constant(null),
);

/** Arbitrary that produces a valid Recipe object. */
const validRecipeArb = fc.record({
  jobName: nonEmptyStringArb,
  recipeNumber: nonEmptyStringArb,
  source: fc.string(),
  title: nonEmptyStringArb,
  author: fc.oneof(nonEmptyStringArb, fc.constant(null)),
  year: fc.oneof(fc.integer({ min: 1900, max: 2030 }), fc.constant(null)),
  category: categoryArb,
  cuisine: cuisineArb,
  tags: fc.array(nonEmptyStringArb, { minLength: 0, maxLength: 5 }),
  ingredients: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 10 }),
  instructions: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 10 }),
  notes: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  imageKeys: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
  confidence: validConfidenceObjArb,
});

// --- Property 1: Schema enum validation (category and cuisine) ---

describe('Feature: pdf-export-improvements, Property 1: Schema enum validation', () => {
  /** Valid category values from the enum. */
  const validCategories: string[] = categoryEnum.options;

  /** Valid cuisine values from the enum. */
  const validCuisines: string[] = cuisineEnum.options;

  /** Arbitrary that produces a string NOT in the valid category enum. */
  const invalidCategoryArb = fc.string({ minLength: 1 }).filter(
    (s) => !validCategories.includes(s),
  );

  /** Arbitrary that produces a string NOT in the valid cuisine enum and not null. */
  const invalidCuisineArb = fc.string({ minLength: 1 }).filter(
    (s) => !validCuisines.includes(s),
  );

  it('accepts any valid category enum value', () => {
    /**
     * Validates: Requirements 1.1, 1.2
     */
    fc.assert(
      fc.property(validRecipeArb, categoryArb, (recipe, category) => {
        const result = recipeSchema.safeParse({ ...recipe, category });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any string not in the category enum', () => {
    /**
     * Validates: Requirements 1.4
     */
    fc.assert(
      fc.property(validRecipeArb, invalidCategoryArb, (recipe, badCategory) => {
        const result = recipeSchema.safeParse({ ...recipe, category: badCategory });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('accepts any valid cuisine enum value or null', () => {
    /**
     * Validates: Requirements 1.2, 1.5
     */
    fc.assert(
      fc.property(validRecipeArb, cuisineArb, (recipe, cuisine) => {
        const result = recipeSchema.safeParse({ ...recipe, cuisine });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any string not in the cuisine enum and not null', () => {
    /**
     * Validates: Requirements 1.5
     */
    fc.assert(
      fc.property(validRecipeArb, invalidCuisineArb, (recipe, badCuisine) => {
        const result = recipeSchema.safeParse({ ...recipe, cuisine: badCuisine });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 5: Confidence score boundary validation ---

describe('Property 5: Confidence score boundary validation', () => {
  it('accepts any number in [0, 1]', () => {
    fc.assert(
      fc.property(validConfidenceArb, (score) => {
        expect(confidenceScoreSchema.safeParse(score).success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any number above 1', () => {
    fc.assert(
      fc.property(aboveOneArb, (score) => {
        expect(confidenceScoreSchema.safeParse(score).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any number below 0', () => {
    fc.assert(
      fc.property(belowZeroArb, (score) => {
        expect(confidenceScoreSchema.safeParse(score).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('accepts scores in [0, 1] within a full Recipe object', () => {
    fc.assert(
      fc.property(validRecipeArb, (recipe) => {
        const result = recipeSchema.safeParse(recipe);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a Recipe with any confidence score above 1', () => {
    const fieldArb = fc.constantFrom(
      'title' as const,
      'ingredients' as const,
      'instructions' as const,
      'notes' as const,
    );

    fc.assert(
      fc.property(validRecipeArb, fieldArb, aboveOneArb, (recipe, field, badScore) => {
        const bad = {
          ...recipe,
          confidence: { ...recipe.confidence, [field]: badScore },
        };
        expect(recipeSchema.safeParse(bad).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 6: Recipe JSON round-trip ---

describe('Property 6: Recipe JSON round-trip', () => {
  it('serializing to JSON and parsing back produces an equivalent object', () => {
    fc.assert(
      fc.property(validRecipeArb, (recipe) => {
        // First parse through schema to get the canonical form (with defaults applied)
        const parsed = recipeSchema.parse(recipe);
        const json = JSON.stringify(parsed);
        const roundTripped = recipeSchema.parse(JSON.parse(json));
        expect(roundTripped).toEqual(parsed);
      }),
      { numRuns: 100 },
    );
  });
});
