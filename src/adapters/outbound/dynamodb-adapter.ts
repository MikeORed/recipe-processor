import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { DataStore } from '../../domain/ports/data-store-port.js';
import type { Recipe, JobStatus } from '../../domain/models/index.js';
import config from '../../config/config.js';

export class DynamoDBAdapter implements DataStore {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly recipesTableName: string;
  private readonly jobsTableName: string;

  constructor() {
    const region = config.get('aws.region');
    const client = new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.recipesTableName = config.get('dynamodb.recipesTableName');
    this.jobsTableName = config.get('dynamodb.jobsTableName');
  }

  async putRecipe(recipe: Recipe): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.recipesTableName,
        Item: {
          ...recipe,
        },
      }),
    );
  }

  // TODO: Add pagination. Single Query works for family-scale collections (dozens to low hundreds)
  // but will silently truncate at 1MB response size for larger datasets.
  async getRecipesByJob(jobName: string): Promise<Recipe[]> {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.recipesTableName,
        KeyConditionExpression: 'jobName = :jn',
        ExpressionAttributeValues: {
          ':jn': jobName,
        },
      }),
    );

    return (response.Items ?? []) as Recipe[];
  }

  async getRecipeWithOcr(
    jobName: string,
    recipeNumber: string,
  ): Promise<{ recipe: Recipe; ocrText: string } | undefined> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.recipesTableName,
        Key: { jobName, recipeNumber },
      }),
    );

    if (!response.Item) {
      return undefined;
    }

    const item = response.Item as Recipe & { ocrText?: string };
    const { ocrText, ...recipe } = item;

    return { recipe: recipe as Recipe, ocrText: ocrText ?? '' };
  }

  async updateJobStatus(jobName: string, status: JobStatus): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.jobsTableName,
        Item: {
          jobName,
          status,
        },
      }),
    );
  }

  async getJobStatus(jobName: string): Promise<JobStatus | undefined> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.jobsTableName,
        Key: {
          jobName,
        },
      }),
    );

    return response.Item?.status as JobStatus | undefined;
  }
}
