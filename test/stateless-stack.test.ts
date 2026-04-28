import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StatefulStack } from '../infra/stateful/stateful-stack.js';
import { StatelessStack } from '../infra/stateless/stateless-stack.js';

describe('StatelessStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stateful = new StatefulStack(app, 'TestStatefulStack');
    const stateless = new StatelessStack(app, 'TestStatelessStack', {
      imagesBucket: stateful.imagesBucket,
      recipesTable: stateful.recipesTable,
      jobsTable: stateful.jobsTable,
    });
    template = Template.fromStack(stateless);
  });

  it('should create a managed policy with S3 scoped access', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'S3ImageAccess',
            Effect: 'Allow',
            Action: ['s3:PutObject', 's3:GetObject', 's3:HeadObject'],
          }),
        ]),
      },
    });
  });

  it('should create a managed policy with DynamoDB Recipes table access', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DynamoDBRecipesAccess',
            Effect: 'Allow',
            Action: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
          }),
        ]),
      },
    });
  });

  it('should create a managed policy with DynamoDB Jobs table access', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DynamoDBJobsAccess',
            Effect: 'Allow',
            Action: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
          }),
        ]),
      },
    });
  });

  it('should create a managed policy with Textract access', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'TextractAccess',
            Effect: 'Allow',
            Action: [
              'textract:StartDocumentTextDetection',
              'textract:GetDocumentTextDetection',
            ],
            Resource: '*',
          }),
        ]),
      },
    });
  });

  it('should create a managed policy with Bedrock InvokeModel access', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'BedrockAccess',
            Effect: 'Allow',
            Action: 'bedrock:InvokeModel',
          }),
        ]),
      },
    });
  });

  it('should scope S3 actions to the images bucket ARN with wildcard', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'S3ImageAccess',
            Resource: {
              'Fn::Join': [
                '',
                Match.arrayWith(['/*']),
              ],
            },
          }),
        ]),
      },
    });
  });
});
