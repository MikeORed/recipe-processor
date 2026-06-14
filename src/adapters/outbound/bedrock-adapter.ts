import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

import type { StructureExtractor, ExtractionInput } from '../../domain/ports/structure-extractor-port.js';
import type { Recipe } from '../../domain/models/recipe.js';
import { recipeSchema } from '../../domain/models/recipe.js';
import { HeirloomError } from '../../shared/errors.js';
import config from '../../config/config.js';

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
  required: ['title', 'author', 'year', 'tags', 'ingredients', 'instructions', 'notes', 'confidence'],
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
- tags: categorize the recipe (appetizer, main, dessert, salad, beverage, bread, side, soup, candy, cookie, pie, cake, casserole, sandwich). Use one or more tags.
- ingredients: array of ingredient strings with quantities, exactly as written
- instructions: array of instruction steps
- notes: array of distinct notes, tips, or commentary specific to THIS recipe. Each note should be a separate array item. Do NOT include generic page filler, unrelated cooking tips, or boilerplate text that isn't about this specific recipe.
- confidence: your confidence (0.0-1.0) in each extracted field

Preserve the original language and phrasing. Do not normalize or rewrite the text.
If the text contains multiple distinct recipes, return each as a separate entry in the recipes array.`;
  }
}
