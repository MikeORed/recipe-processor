const sendMock = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  ConverseCommand: jest.fn().mockImplementation((input: unknown) => ({
    _type: 'ConverseCommand',
    input,
  })),
}));

import fc from 'fast-check';
import { BedrockAdapter } from './bedrock-adapter.js';
import { HeirloomError } from '../../shared/errors.js';
import type { ExtractionInput } from '../../domain/ports/structure-extractor-port.js';

// --- Valid enum values (from schema) ---

/** The full 15-item category enum (14 canonical + "uncategorized") that the schema accepts. */
const FULL_CATEGORY_ENUM = [
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
] as const;

/** The 15-item cuisine enum that the schema accepts. */
const CUISINE_ENUM = [
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
] as const;

// --- Helpers ---

function makeInput(): ExtractionInput {
  return {
    ocrText: '1 cup flour\n2 eggs\nMix and bake at 350F',
    recipeNumber: 'R001',
    source: 'grandma-cards',
    jobName: 'my-job',
    imageKeys: ['my-job/card-front.jpg'],
  };
}

function makeValidRecipeRaw(overrides?: Record<string, unknown>) {
  return {
    title: "Grandma's Cake",
    author: 'Grandma',
    year: null,
    category: 'Cakes',
    cuisine: null,
    tags: ['dessert'],
    ingredients: ['1 cup flour', '2 eggs'],
    instructions: ['Mix and bake at 350F'],
    notes: [],
    confidence: {
      title: 0.95,
      ingredients: 0.9,
      instructions: 0.85,
      notes: 0.7,
    },
    ...overrides,
  };
}

function makeConverseResponse(recipes: unknown[]) {
  return {
    output: {
      message: {
        role: 'assistant',
        content: [{ text: JSON.stringify({ recipes }) }],
      },
    },
    stopReason: 'end_turn',
  };
}

// --- Arbitraries ---

/** Arbitrary that produces a string NOT in the full category enum (15 values). */
const invalidCategoryArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => !(FULL_CATEGORY_ENUM as readonly string[]).includes(s));

/** Arbitrary that produces a string NOT in the cuisine enum (15 values). */
const invalidCuisineArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => !(CUISINE_ENUM as readonly string[]).includes(s));

/** Arbitrary that produces a valid category from the full 15-item enum. */
const validCategoryArb = fc.constantFrom(...FULL_CATEGORY_ENUM);

/** Arbitrary that produces a valid cuisine value (15-item enum or null). */
const validCuisineArb = fc.oneof(
  fc.constantFrom(...CUISINE_ENUM),
  fc.constant(null),
);

// --- Property 2: FM response category/cuisine validation ---

describe('Feature: pdf-export-improvements, Property 2: FM response category/cuisine validation', () => {
  let adapter: BedrockAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockReset();
    adapter = new BedrockAdapter();
  });

  /**
   * Validates: Requirements 2.5, 2.6
   */
  it('rejects any category value not in the full category enum', async () => {
    await fc.assert(
      fc.asyncProperty(invalidCategoryArb, async (badCategory) => {
        const recipe = makeValidRecipeRaw({ category: badCategory });
        sendMock.mockResolvedValue(makeConverseResponse([recipe]));

        await expect(adapter.extract(makeInput())).rejects.toThrow(HeirloomError);
        sendMock.mockResolvedValue(makeConverseResponse([recipe]));
        await expect(adapter.extract(makeInput())).rejects.toThrow(
          /schema validation/i,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.5, 2.6
   */
  it('rejects any cuisine value not in the cuisine enum and not null', async () => {
    await fc.assert(
      fc.asyncProperty(invalidCuisineArb, async (badCuisine) => {
        const recipe = makeValidRecipeRaw({ cuisine: badCuisine });
        sendMock.mockResolvedValue(makeConverseResponse([recipe]));

        await expect(adapter.extract(makeInput())).rejects.toThrow(HeirloomError);
        sendMock.mockResolvedValue(makeConverseResponse([recipe]));
        await expect(adapter.extract(makeInput())).rejects.toThrow(
          /schema validation/i,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.5, 2.6
   *
   * Boundary confirmation: valid category values are accepted by the adapter.
   */
  it('accepts any valid category value from the full enum', async () => {
    await fc.assert(
      fc.asyncProperty(validCategoryArb, async (validCategory) => {
        const recipe = makeValidRecipeRaw({ category: validCategory });
        sendMock.mockResolvedValue(makeConverseResponse([recipe]));

        const result = await adapter.extract(makeInput());
        expect(result).toHaveLength(1);
        expect(result[0].category).toBe(validCategory);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.5, 2.6
   *
   * Boundary confirmation: valid cuisine values (including null) are accepted.
   */
  it('accepts any valid cuisine value or null', async () => {
    await fc.assert(
      fc.asyncProperty(validCuisineArb, async (validCuisine) => {
        const recipe = makeValidRecipeRaw({ cuisine: validCuisine });
        sendMock.mockResolvedValue(makeConverseResponse([recipe]));

        const result = await adapter.extract(makeInput());
        expect(result).toHaveLength(1);
        expect(result[0].cuisine).toBe(validCuisine);
      }),
      { numRuns: 100 },
    );
  });
});
