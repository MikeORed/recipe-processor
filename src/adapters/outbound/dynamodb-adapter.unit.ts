const sendMock = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: sendMock }),
  },
  PutCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'PutCommand', input })),
  GetCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'GetCommand', input })),
  QueryCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'QueryCommand', input })),
}));

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBAdapter } from './dynamodb-adapter.js';
import config from '../../config/config.js';
import type { Recipe } from '../../domain/models/index.js';

function makeRecipe(overrides?: Partial<Recipe>): Recipe {
  return {
    jobName: 'my-job',
    recipeNumber: 'R001',
    source: 'grandma-cards',
    title: 'Chocolate Cake',
    author: null,
    year: null,
    category: 'Cakes',
    cuisine: null,
    tags: ['dessert'],
    ingredients: ['1 cup flour', '2 eggs', '1 cup sugar'],
    instructions: ['Mix ingredients', 'Bake at 350F for 30 min'],
    notes: ['Family favorite'],
    imageKeys: ['my-job/card-front.jpg'],
    confidence: {
      title: 0.95,
      ingredients: 0.9,
      instructions: 0.85,
      notes: 0.7,
    },
    ...overrides,
  };
}

describe('DynamoDBAdapter', () => {
  let adapter: DynamoDBAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockReset().mockResolvedValue({});
    adapter = new DynamoDBAdapter();
  });

  describe('constructor', () => {
    it('reads region from convict config and creates DynamoDB client', () => {
      expect(DynamoDBClient).toHaveBeenCalledWith({
        region: config.get('aws.region'),
      });
    });
  });

  describe('putRecipe', () => {
    it('sends PutCommand with correct table name, PK, SK, and item', async () => {
      const recipe = makeRecipe();
      await adapter.putRecipe(recipe);

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(PutCommand).toHaveBeenCalledWith({
        TableName: config.get('dynamodb.recipesTableName'),
        Item: {
          jobName: 'my-job',
          recipeNumber: 'R001',
          source: 'grandma-cards',
          title: 'Chocolate Cake',
          author: null,
          year: null,
          category: 'Cakes',
          cuisine: null,
          tags: ['dessert'],
          ingredients: ['1 cup flour', '2 eggs', '1 cup sugar'],
          instructions: ['Mix ingredients', 'Bake at 350F for 30 min'],
          notes: ['Family favorite'],
          imageKeys: ['my-job/card-front.jpg'],
          confidence: {
            title: 0.95,
            ingredients: 0.9,
            instructions: 0.85,
            notes: 0.7,
          },
        },
      });
    });
  });

  describe('getRecipesByJob', () => {
    it('queries with correct key condition expression', async () => {
      const recipe = makeRecipe();
      sendMock.mockResolvedValue({ Items: [recipe] });

      const result = await adapter.getRecipesByJob('my-job');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(QueryCommand).toHaveBeenCalledWith({
        TableName: config.get('dynamodb.recipesTableName'),
        KeyConditionExpression: 'jobName = :jn',
        ExpressionAttributeValues: {
          ':jn': 'my-job',
        },
      });
      expect(result).toEqual([recipe]);
    });

    it('returns empty array when no items found', async () => {
      sendMock.mockResolvedValue({ Items: undefined });

      const result = await adapter.getRecipesByJob('empty-job');

      expect(result).toEqual([]);
    });
  });

  describe('updateJobStatus', () => {
    it('writes to jobs table with correct PK and status', async () => {
      await adapter.updateJobStatus('my-job', 'transcribing');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(PutCommand).toHaveBeenCalledWith({
        TableName: config.get('dynamodb.jobsTableName'),
        Item: {
          jobName: 'my-job',
          status: 'transcribing',
        },
      });
    });
  });

  describe('getJobStatus', () => {
    it('returns status when job exists', async () => {
      sendMock.mockResolvedValue({
        Item: { jobName: 'my-job', status: 'ingested' },
      });

      const result = await adapter.getJobStatus('my-job');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(GetCommand).toHaveBeenCalledWith({
        TableName: config.get('dynamodb.jobsTableName'),
        Key: { jobName: 'my-job' },
      });
      expect(result).toBe('ingested');
    });

    it('returns undefined when job not found', async () => {
      sendMock.mockResolvedValue({ Item: undefined });

      const result = await adapter.getJobStatus('nonexistent-job');

      expect(result).toBeUndefined();
    });
  });
});
