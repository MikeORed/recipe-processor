import convict from 'convict';

const config = convict({
  aws: {
    region: {
      doc: 'AWS region for all services',
      format: String,
      default: 'us-east-1',
      env: 'HEIRLOOM_AWS_REGION',
    },
  },
  s3: {
    bucketName: {
      doc: 'S3 bucket for image storage',
      format: String,
      default: 'heirloom-images',
      env: 'HEIRLOOM_BUCKET_NAME',
    },
  },
  bedrock: {
    modelId: {
      doc: 'Bedrock model ID for structure extraction',
      format: String,
      default: 'anthropic.claude-3-haiku-20240307-v1:0',
      env: 'HEIRLOOM_BEDROCK_MODEL_ID',
    },
  },
  dynamodb: {
    recipesTableName: {
      doc: 'DynamoDB table for recipe records',
      format: String,
      default: 'heirloom-recipes',
      env: 'HEIRLOOM_RECIPES_TABLE',
    },
    jobsTableName: {
      doc: 'DynamoDB table for job tracking',
      format: String,
      default: 'heirloom-jobs',
      env: 'HEIRLOOM_JOBS_TABLE',
    },
  },
});

config.validate({ allowed: 'strict' });

export default config;
