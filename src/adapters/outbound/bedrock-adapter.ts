import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

import type { StructureExtractor, ExtractionInput } from '../../domain/ports/structure-extractor-port.js';
import type { Recipe } from '../../domain/models/recipe.js';
import { recipeSchema } from '../../domain/models/recipe.js';
import { HeirloomError } from '../../shared/errors.js';
import config from '../../config/config.js';

const CATEGORY_ENUM = [
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

const RECIPE_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'The recipe title' },
    author: {
      type: ['string', 'null'],
      description: 'The person who contributed or authored the recipe, if mentioned. null if not stated.',
    },
    year: {
      type: ['integer', 'null'],
      description: 'The year the recipe was written or contributed, if mentioned. null if not stated.',
    },
    category: {
      type: 'string',
      enum: [...CATEGORY_ENUM],
      description: 'The single best cookbook chapter for this recipe. Use the classification heuristic described in the prompt.',
    },
    cuisine: {
      type: ['string', 'null'],
      enum: [...CUISINE_ENUM, null],
      description: 'The cuisine tradition this recipe belongs to. null if unclear or not applicable.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Category tags for the recipe (e.g. appetizer, main, dessert, salad, beverage, bread, side, soup, candy, cookie, pie, cake)',
    },
    ingredients: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of ingredients with quantities',
    },
    instructions: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of instruction steps',
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of distinct notes, tips, or commentary about the recipe. Each note is a separate item. Omit generic page filler or unrelated tips.',
    },
    confidence: {
      type: 'object',
      properties: {
        title: { type: 'number', description: 'Confidence score for title extraction (0.0-1.0)' },
        ingredients: { type: 'number', description: 'Confidence score for ingredients extraction (0.0-1.0)' },
        instructions: { type: 'number', description: 'Confidence score for instructions extraction (0.0-1.0)' },
        notes: { type: 'number', description: 'Confidence score for notes extraction (0.0-1.0)' },
      },
      required: ['title', 'ingredients', 'instructions', 'notes'],
      additionalProperties: false,
    },
  },
  required: ['title', 'author', 'year', 'category', 'cuisine', 'tags', 'ingredients', 'instructions', 'notes', 'confidence'],
  additionalProperties: false,
};

const RECIPES_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: RECIPE_OBJECT_SCHEMA,
      description: 'Array of recipes extracted from the OCR text. Usually one, but may be multiple if the source contains more than one recipe.',
    },
  },
  required: ['recipes'],
  additionalProperties: false,
});

export class BedrockAdapter implements StructureExtractor {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor() {
    const region = config.get('aws.region');
    this.modelId = config.get('bedrock.modelId');
    this.client = new BedrockRuntimeClient({ region });
  }

  async extract(input: ExtractionInput): Promise<Recipe[]> {
    const prompt = this.buildPrompt(input);

    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: 4096,
        },
        outputConfig: {
          textFormat: {
            type: 'json_schema',
            structure: {
              jsonSchema: {
                schema: RECIPES_JSON_SCHEMA,
                name: 'recipe_extraction',
                description: 'Extract structured recipe data from OCR text',
              },
            },
          },
        },
      }),
    );

    const content = response.output?.message?.content?.[0];
    if (!content || !('text' in content) || !content.text) {
      throw new HeirloomError('Bedrock returned no content in response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content.text);
    } catch (cause) {
      throw new HeirloomError('Bedrock returned invalid JSON', cause);
    }

    const envelope = parsed as { recipes?: unknown[] };
    if (!envelope.recipes || !Array.isArray(envelope.recipes)) {
      throw new HeirloomError('Bedrock response missing recipes array');
    }

    if (envelope.recipes.length === 0) {
      throw new HeirloomError('Bedrock extracted zero recipes from OCR text');
    }

    // Hydrate each extracted recipe with job metadata
    const recipes: Recipe[] = [];
    const suffix = (i: number, total: number): string =>
      total === 1 ? '' : String.fromCharCode(97 + i); // a, b, c...

    for (let i = 0; i < envelope.recipes.length; i++) {
      const raw = envelope.recipes[i] as Record<string, unknown>;
      const hydrated = {
        ...raw,
        jobName: input.jobName,
        recipeNumber: `${input.recipeNumber}${suffix(i, envelope.recipes.length)}`,
        source: input.source,
        imageKeys: input.imageKeys,
      };

      const result = recipeSchema.safeParse(hydrated);
      if (!result.success) {
        throw new HeirloomError(
          `Bedrock response failed schema validation for recipe ${i + 1}: ${result.error.message}`,
          result.error,
        );
      }

      recipes.push(result.data);
    }

    return recipes;
  }

  private buildPrompt(input: ExtractionInput): string {
    return `You are a recipe transcription assistant. Extract structured recipe data from the following OCR text.

The text may contain ONE or MULTIPLE recipes. Return ALL recipes you find.

Job Name: ${input.jobName}
Recipe Number: ${input.recipeNumber}
Source: ${input.source}
Image Keys: ${input.imageKeys.join(', ')}

OCR Text:
${input.ocrText}

For each recipe found, extract:
- title: the recipe title exactly as written
- author: the person who contributed or wrote the recipe (look for "By ...", "From ...", or a name near the recipe). null if not stated.
- year: the year if mentioned or clearly implied. null if not stated.
- category: the single best cookbook chapter (see classification heuristic below)
- cuisine: the cuisine tradition (see cuisine list below). null if unclear or not applicable.
- tags: supplementary category tags (appetizer, main, dessert, salad, beverage, bread, side, soup, candy, cookie, pie, cake, casserole, sandwich). Use one or more tags.
- ingredients: array of ingredient strings with quantities, exactly as written
- instructions: array of instruction steps
- notes: array of distinct notes, tips, or commentary specific to THIS recipe. Each note should be a separate array item. Do NOT include generic page filler, unrelated cooking tips, or boilerplate text that isn't about this specific recipe.
- confidence: your confidence (0.0-1.0) in each extracted field

## Category Classification Heuristic

Assign exactly one category from this list: ${CATEGORY_ENUM.join(', ')}.

Apply the following precedence chain (highest priority first):

1. TYPE EXCEPTIONS (highest priority — always override protein):
   - Dips, spreads, finger foods, party snacks → "Appetizers & Snacks"
   - Candy and frozen desserts → "Cookies & Bars"
   - Gelatin salads and fruit salads → "Salads & Dressings"

2. PRIMARY PROTEIN: If the recipe features a dominant protein, classify by that protein's chapter:
   - Beef, pork, ham, sausage, ground beef → "Beef & Pork"
   - Chicken, turkey, game hen → "Poultry"
   - Shrimp, fish, crab, lobster, clam, oyster → "Seafood"

3. DISH STRUCTURE: If no dominant protein or type exception applies, classify by the dish form:
   - Soup, stew, chowder, chili → "Soups & Stews"
   - Pasta, noodles, rice dishes → "Pasta & Rice"
   - Bread, rolls, muffins, biscuits → "Breads"
   - Cake, cupcakes → "Cakes"
   - Pie, pastry, cobbler, tart → "Pies & Pastries"
   - Cookies, bars, brownies → "Cookies & Bars"
   - Beverages, punch, tea, smoothie → "Beverages"
   - Sauce, dressing, condiment, marinade → "Sauces & Condiments"
   - Salad (non-gelatin, non-fruit) → "Salads & Dressings"
   - Vegetable-forward side dish → "Sides & Vegetables"

4. FALLBACK: If still ambiguous after all rules, prefer the protein chapter over the structural chapter.

## Cuisine Classification

Assign one cuisine from: ${CUISINE_ENUM.join(', ')}. Use null if the cuisine is unclear or the recipe is a generic American home-cooking recipe with no clear ethnic tradition.

## Few-Shot Examples

Example 1:
OCR text excerpt: "Chicken Dip — 2 cans chunk chicken, 8 oz cream cheese, salsa... mix and serve with chips"
category: "Appetizers & Snacks"
cuisine: "American"
Rationale: Type exception for dips overrides the chicken protein. It is served as a party snack with chips.

Example 2:
OCR text excerpt: "Shrimp Gumbo — 1 lb shrimp, okra, roux, file powder... serve over rice"
category: "Seafood"
cuisine: "American Regional"
Rationale: Primary protein is shrimp. Although gumbo is a soup/stew by structure, the dominant protein rule (level 2) takes precedence over dish structure (level 3). Cuisine is American Regional (Cajun/Creole).

Example 3:
OCR text excerpt: "Strawberry Pretzel Salad — pretzels, cream cheese, strawberry Jello, Cool Whip... refrigerate until set"
category: "Salads & Dressings"
cuisine: "American"
Rationale: Type exception for gelatin salads overrides any other classification. Despite being dessert-like, gelatin salads belong in Salads & Dressings per the type exception rule.

Example 4:
OCR text excerpt: "Beef Burgundy — 2 lbs stew meat, burgundy wine, mushrooms, onions... simmer 2 hours"
category: "Beef & Pork"
cuisine: "French"
Rationale: Primary protein is beef. Although the dish structure is a stew, the dominant protein rule (level 2) takes precedence over dish structure (level 3). Cuisine is French (Burgundy wine sauce tradition).

Preserve the original language and phrasing. Do not normalize or rewrite the text.
If the text contains multiple distinct recipes, return each as a separate entry in the recipes array.`;
  }
}
