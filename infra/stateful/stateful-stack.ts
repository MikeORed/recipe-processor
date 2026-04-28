import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export class StatefulStack extends cdk.Stack {
  public readonly imagesBucket: s3.Bucket;
  public readonly recipesTable: dynamodb.Table;
  public readonly jobsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.imagesBucket = new s3.Bucket(this, 'ImagesBucket', {
      bucketName: 'heirloom-images',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.recipesTable = new dynamodb.Table(this, 'RecipesTable', {
      tableName: 'heirloom-recipes',
      partitionKey: { name: 'jobName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'recipeNumber', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName: 'heirloom-jobs',
      partitionKey: { name: 'jobName', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
