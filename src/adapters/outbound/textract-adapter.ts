import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';

import type { OCRProvider, OCRResult } from '../../domain/ports/ocr-provider-port.js';
import config from '../../config/config.js';

const POLL_INTERVAL_MS = 2000;

export class TextractAdapter implements OCRProvider {
  private readonly client: TextractClient;
  private readonly bucketName: string;

  constructor() {
    const region = config.get('aws.region');
    this.bucketName = config.get('s3.bucketName');
    this.client = new TextractClient({ region });
  }

  async extractText(imageKey: string): Promise<OCRResult> {
    const startResponse = await this.client.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: this.bucketName,
            Name: imageKey,
          },
        },
      }),
    );

    const jobId = startResponse.JobId;
    if (!jobId) {
      throw new Error('Textract did not return a JobId');
    }

    return this.pollForResult(jobId);
  }

  // TODO: Add a max-poll timeout (e.g. 5 minutes) so a stuck Textract job doesn't hang indefinitely.
  // Consider exponential backoff instead of fixed 2s intervals.
  private async pollForResult(jobId: string): Promise<OCRResult> {
    while (true) {
      const response = await this.client.send(
        new GetDocumentTextDetectionCommand({ JobId: jobId }),
      );

      const status = response.JobStatus;

      if (status === 'SUCCEEDED') {
        const blocks = (response.Blocks ?? [])
          .filter((block) => block.BlockType === 'LINE')
          .map((block) => ({
            text: block.Text ?? '',
            confidence: (block.Confidence ?? 0) / 100,
          }));

        return { blocks };
      }

      if (status === 'FAILED') {
        throw new Error(
          `Textract job ${jobId} failed: ${response.StatusMessage ?? 'unknown error'}`,
        );
      }

      // IN_PROGRESS — wait and retry
      await this.delay(POLL_INTERVAL_MS);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
