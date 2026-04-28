import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

import type { StructureExtractor, ExtractionInput } from '../../domain/ports/structure-extractor-port.js';
import type { Recipe } from '../../domain/models/recipe.js';
import { recipeSchema } from '../../domain/models/recipe.js';
import { HeirloomError } from '../../shared/errors.js';
import config from '../../config/config.js';

const RECIPE_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    jobName: { type: 'string', description: 'The job name this recipe belongs to' },
    recipeNumber: { type: 'string', description: 'The recipe number from the manifest' },
    source: { type: 'string', description: 'The source collection name' },
    title: { type: 'string', description: 'The recipe title' },
    ingredients: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of ingredients',
    },
    instructions: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of instructions',
    },
    notes: { type: 'string', description: 'Additional notes about the recipe' },
    imageKeys: {
      type: 'array',
      items: { type: 'string' },
      description: 'S3 keys of the source images',
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
  required: [
    'jobName', 'recipeNumber', 'source', 'title',
    'ingredients', 'instructions', 'notes', 'imageKeys', 'confidence',
  ],
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

  async extract(input: ExtractionInput): Promise<Recipe> {
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
                schema: RECIPE_JSON_SCHEMA,
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

    const result = recipeSchema.safeParse(parsed);
    if (!result.success) {
      throw new HeirloomError(
        `Bedrock response failed schema validation: ${result.error.message}`,
        result.error,
      );
    }

    return result.data;
  }

  private buildPrompt(input: ExtractionInput): string {
    return `You are a recipe transcription assistant. Extract structured recipe data from the following OCR text.

Job Name: ${input.jobName}
Recipe Number: ${input.recipeNumber}
Source: ${input.source}
Image Keys: ${input.imageKeys.join(', ')}

OCR Text:
${input.ocrText}

Extract the recipe into structured fields. Use these exact values:
- jobName: "${input.jobName}"
- recipeNumber: "${input.recipeNumber}"
- source: "${input.source}"
- imageKeys: ${JSON.stringify(input.imageKeys)}

For the remaining fields, extract from the OCR text:
- title: the recipe title
- ingredients: array of ingredient strings
- instructions: array of instruction steps
- notes: any additional notes (empty string if none)
- confidence: your confidence (0.0-1.0) in each extracted field

Preserve the original language and phrasing. Do not normalize or rewrite the text.`;
  }
}
