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
