import { readFile } from 'node:fs/promises';

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import type { ObjectStore } from '../../domain/ports/object-store-port.js';
import config from '../../config/config.js';

export class S3Adapter implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const region = config.get('aws.region');
    this.bucketName = config.get('s3.bucketName');
    this.client = new S3Client({ region });
  }

  // TODO: This buffers the entire file in memory. Fine for typical recipe-card photos (1–5MB),
  // but would OOM on very large files without a useful error. Consider streaming upload via
  // createReadStream for robustness, or at minimum a file-size check with a clear error message.
  async upload(localPath: string, key: string): Promise<void> {
    const body = await readFile(localPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }
}
