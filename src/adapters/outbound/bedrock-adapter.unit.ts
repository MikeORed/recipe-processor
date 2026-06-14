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

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAdapter } from './bedrock-adapter.js';
import { HeirloomError } from '../../shared/errors.js';
import config from '../../config/config.js';
import type { ExtractionInput } from '../../domain/ports/structure-extractor-port.js';

function makeInput(overrides?: Partial<ExtractionInput>): ExtractionInput {
  return {
    ocrText: '1 cup flour\n2 eggs\nMix and bake at 350F',
    recipeNumber: 'R001',
    source: 'grandma-cards',
    jobName: 'my-job',
    imageKeys: ['my-job/card-front.jpg', 'my-job/card-back.jpg'],
    ...overrides,
  };
}

function makeValidRecipe(input: ExtractionInput) {
  return {
    title: "Grandma's Cake",
    author: "Grandma",
    year: null,
    tags: ['dessert', 'cake'],
    ingredients: ['1 cup flour', '2 eggs'],
    instructions: ['Mix and bake at 350F'],
    notes: [],
    confidence: {
      title: 0.95,
      ingredients: 0.9,
      instructions: 0.85,
      notes: 0.7,
    },
  };
}

function makeValidRecipeEnvelope(input: ExtractionInput) {
  return { recipes: [makeValidRecipe(input)] };
}

function makeHydratedRecipe(input: ExtractionInput) {
  return {
    jobName: input.jobName,
    recipeNumber: input.recipeNumber,
    source: input.source,
    title: "Grandma's Cake",
    author: "Grandma",
    year: null,
    tags: ['dessert', 'cake'],
    ingredients: ['1 cup flour', '2 eggs'],
    instructions: ['Mix and bake at 350F'],
    notes: [],
    imageKeys: input.imageKeys,
    confidence: {
      title: 0.95,
      ingredients: 0.9,
      instructions: 0.85,
      notes: 0.7,
    },
  };
}

function makeConverseResponse(jsonText: string) {
  return {
    output: {
      message: {
        role: 'assistant',
        content: [{ text: jsonText }],
      },
    },
    stopReason: 'end_turn',
  };
}

describe('BedrockAdapter', () => {
  let adapter: BedrockAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockReset();
    adapter = new BedrockAdapter();
  });

  describe('constructor', () => {
    it('reads region and model ID from convict config', () => {
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region: config.get('aws.region'),
      });
    });
  });

  describe('extract', () => {
    it('sends ConverseCommand with structured output config and prompt containing metadata', async () => {
      const input = makeInput();
      const envelope = makeValidRecipeEnvelope(input);
      sendMock.mockResolvedValue(makeConverseResponse(JSON.stringify(envelope)));

      await adapter.extract(input);

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(ConverseCommand).toHaveBeenCalledTimes(1);

      const commandInput = jest.mocked(ConverseCommand).mock.calls[0][0];
      expect(commandInput.modelId).toBe(config.get('bedrock.modelId'));

      // Verify structured output config
      expect(commandInput.outputConfig?.textFormat?.type).toBe('json_schema');
      expect(commandInput.outputConfig?.textFormat?.structure?.jsonSchema?.name).toBe('recipe_extraction');

      // Verify prompt contains OCR text and metadata
      const prompt = commandInput.messages?.[0]?.content?.[0];
      expect(prompt).toBeDefined();
      expect('text' in prompt!).toBe(true);
      const promptText = (prompt as { text: string }).text;
      expect(promptText).toContain(input.ocrText);
      expect(promptText).toContain(input.recipeNumber);
      expect(promptText).toContain(input.source);
      expect(promptText).toContain(input.jobName);
    });

    it('parses and validates a valid JSON response against recipeSchema', async () => {
      const input = makeInput();
      const envelope = makeValidRecipeEnvelope(input);
      sendMock.mockResolvedValue(makeConverseResponse(JSON.stringify(envelope)));

      const result = await adapter.extract(input);

      expect(result).toEqual([makeHydratedRecipe(input)]);
    });

    it('returns multiple recipes when response contains more than one', async () => {
      const input = makeInput();
      const envelope = {
        recipes: [
          makeValidRecipe(input),
          { ...makeValidRecipe(input), title: 'Second Recipe' },
        ],
      };
      sendMock.mockResolvedValue(makeConverseResponse(JSON.stringify(envelope)));

      const result = await adapter.extract(input);

      expect(result).toHaveLength(2);
      expect(result[0].recipeNumber).toBe('R001a');
      expect(result[1].recipeNumber).toBe('R001b');
      expect(result[1].title).toBe('Second Recipe');
    });

    it('throws HeirloomError when response is not valid JSON', async () => {
      const input = makeInput();
      sendMock.mockResolvedValue(makeConverseResponse('not json at all'));

      await expect(adapter.extract(input)).rejects.toThrow(HeirloomError);
      await expect(adapter.extract(input)).rejects.toThrow('Bedrock returned invalid JSON');
    });

    it('throws HeirloomError when response fails Zod validation', async () => {
      const input = makeInput();
      const invalidEnvelope = {
        recipes: [{
          // missing required fields
          title: "Grandma's Cake",
        }],
      };
      sendMock.mockResolvedValue(makeConverseResponse(JSON.stringify(invalidEnvelope)));

      await expect(adapter.extract(input)).rejects.toThrow(HeirloomError);
      await expect(adapter.extract(input)).rejects.toThrow('Bedrock response failed schema validation');
    });

    it('throws HeirloomError when confidence score is out of range', async () => {
      const input = makeInput();
      const envelope = {
        recipes: [{
          ...makeValidRecipe(input),
          confidence: {
            title: 1.5, // out of range
            ingredients: 0.9,
            instructions: 0.85,
            notes: 0.7,
          },
        }],
      };
      sendMock.mockResolvedValue(makeConverseResponse(JSON.stringify(envelope)));

      await expect(adapter.extract(input)).rejects.toThrow(HeirloomError);
      await expect(adapter.extract(input)).rejects.toThrow('Bedrock response failed schema validation');
    });

    it('throws HeirloomError when Bedrock returns no content', async () => {
      const input = makeInput();
      sendMock.mockResolvedValue({
        output: { message: { role: 'assistant', content: [] } },
        stopReason: 'end_turn',
      });

      await expect(adapter.extract(input)).rejects.toThrow(HeirloomError);
      await expect(adapter.extract(input)).rejects.toThrow('Bedrock returned no content in response');
    });

    it('throws HeirloomError when Bedrock returns no output message', async () => {
      const input = makeInput();
      sendMock.mockResolvedValue({ output: {}, stopReason: 'end_turn' });

      await expect(adapter.extract(input)).rejects.toThrow(HeirloomError);
      await expect(adapter.extract(input)).rejects.toThrow('Bedrock returned no content in response');
    });

    it('throws HeirloomError when recipes array is empty', async () => {
      const input = makeInput();
      sendMock.mockResolvedValue(makeConverseResponse(JSON.stringify({ recipes: [] })));

      await expect(adapter.extract(input)).rejects.toThrow(HeirloomError);
      await expect(adapter.extract(input)).rejects.toThrow('Bedrock extracted zero recipes from OCR text');
    });

    it('throws HeirloomError when recipes key is missing', async () => {
      const input = makeInput();
      sendMock.mockResolvedValue(makeConverseResponse(JSON.stringify({ notRecipes: [] })));

      await expect(adapter.extract(input)).rejects.toThrow(HeirloomError);
      await expect(adapter.extract(input)).rejects.toThrow('Bedrock response missing recipes array');
    });
  });
});
