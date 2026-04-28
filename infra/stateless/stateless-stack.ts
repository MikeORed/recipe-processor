import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export interface StatelessStackProps extends cdk.StackProps {
  imagesBucket: s3.IBucket;
  recipesTable: dynamodb.ITable;
  jobsTable: dynamodb.ITable;
  bedrockModelArn?: string;
}

export class StatelessStack extends cdk.Stack {
  public readonly heirloomPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: StatelessStackProps) {
    super(scope, id, props);

    const bedrockModelArn =
      props.bedrockModelArn ?? 'arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0';

    this.heirloomPolicy = new iam.ManagedPolicy(this, 'HeirloomTranscribePolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'S3ImageAccess',
          effect: iam.Effect.ALLOW,
          actions: ['s3:PutObject', 's3:GetObject', 's3:HeadObject'],
          resources: [props.imagesBucket.arnForObjects('*')],
        }),
        new iam.PolicyStatement({
          sid: 'DynamoDBRecipesAccess',
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
          resources: [props.recipesTable.tableArn],
        }),
        new iam.PolicyStatement({
          sid: 'DynamoDBJobsAccess',
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
          resources: [props.jobsTable.tableArn],
        }),
        new iam.PolicyStatement({
          sid: 'TextractAccess',
          effect: iam.Effect.ALLOW,
          actions: [
            'textract:StartDocumentTextDetection',
            'textract:GetDocumentTextDetection',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'BedrockAccess',
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeModel'],
          resources: [bedrockModelArn],
        }),
      ],
    });
  }
}
