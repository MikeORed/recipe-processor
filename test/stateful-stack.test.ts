import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StatefulStack } from '../infra/stateful/stateful-stack.js';

describe('StatefulStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new StatefulStack(app, 'TestStatefulStack');
    template = Template.fromStack(stack);
  });

  describe('S3 Images Bucket', () => {
    it('should create an S3 bucket named heirloom-images', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'heirloom-images',
      });
    });

    it('should have RETAIN removal policy', () => {
      template.hasResource('AWS::S3::Bucket', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      });
    });
  });

  describe('DynamoDB Recipes Table', () => {
    it('should create a table named heirloom-recipes with correct key schema', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'heirloom-recipes',
        KeySchema: [
          { AttributeName: 'jobName', KeyType: 'HASH' },
          { AttributeName: 'recipeNumber', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'jobName', AttributeType: 'S' },
          { AttributeName: 'recipeNumber', AttributeType: 'S' },
        ],
      });
    });

    it('should have RETAIN removal policy', () => {
      template.hasResource('AWS::DynamoDB::Table', {
        Properties: {
          TableName: 'heirloom-recipes',
        },
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      });
    });
  });

  describe('DynamoDB Jobs Table', () => {
    it('should create a table named heirloom-jobs with correct key schema', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'heirloom-jobs',
        KeySchema: [
          { AttributeName: 'jobName', KeyType: 'HASH' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'jobName', AttributeType: 'S' },
        ],
      });
    });

    it('should have RETAIN removal policy', () => {
      template.hasResource('AWS::DynamoDB::Table', {
        Properties: {
          TableName: 'heirloom-jobs',
        },
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      });
    });
  });
});
