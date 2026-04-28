const sendMock = jest.fn();

jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  StartDocumentTextDetectionCommand: jest.fn().mockImplementation((input: unknown) => ({
    _type: 'StartDocumentTextDetectionCommand',
    input,
  })),
  GetDocumentTextDetectionCommand: jest.fn().mockImplementation((input: unknown) => ({
    _type: 'GetDocumentTextDetectionCommand',
    input,
  })),
}));

import { TextractClient, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } from '@aws-sdk/client-textract';
import { TextractAdapter } from './textract-adapter.js';
import config from '../../config/config.js';

describe('TextractAdapter', () => {
  let adapter: TextractAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    sendMock.mockReset();
    adapter = new TextractAdapter();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('reads region and bucket name from convict config', () => {
      expect(TextractClient).toHaveBeenCalledWith({
        region: config.get('aws.region'),
      });
    });
  });

  describe('extractText', () => {
    it('starts a job with correct S3 bucket and key', async () => {
      sendMock
        .mockResolvedValueOnce({ JobId: 'job-123' })
        .mockResolvedValueOnce({
          JobStatus: 'SUCCEEDED',
          Blocks: [],
        });

      await adapter.extractText('my-job/image.jpg');

      expect(StartDocumentTextDetectionCommand).toHaveBeenCalledWith({
        DocumentLocation: {
          S3Object: {
            Bucket: config.get('s3.bucketName'),
            Name: 'my-job/image.jpg',
          },
        },
      });
    });

    it('polls until SUCCEEDED and collects LINE blocks', async () => {
      sendMock
        .mockResolvedValueOnce({ JobId: 'job-123' })
        .mockResolvedValueOnce({ JobStatus: 'IN_PROGRESS' })
        .mockResolvedValueOnce({
          JobStatus: 'SUCCEEDED',
          Blocks: [
            { BlockType: 'LINE', Text: 'Mix flour and sugar', Confidence: 95.5 },
            { BlockType: 'WORD', Text: 'Mix', Confidence: 98.0 },
            { BlockType: 'LINE', Text: 'Bake at 350F', Confidence: 88.0 },
          ],
        });

      const resultPromise = adapter.extractText('my-job/image.jpg');

      // Advance past the poll delay
      await jest.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.blocks).toEqual([
        { text: 'Mix flour and sugar', confidence: 0.955 },
        { text: 'Bake at 350F', confidence: 0.88 },
      ]);

      // Verify polling used GetDocumentTextDetectionCommand
      expect(GetDocumentTextDetectionCommand).toHaveBeenCalledWith({ JobId: 'job-123' });
    });

    it('normalizes Textract confidence from 0-100 to 0.0-1.0', async () => {
      sendMock
        .mockResolvedValueOnce({ JobId: 'job-123' })
        .mockResolvedValueOnce({
          JobStatus: 'SUCCEEDED',
          Blocks: [
            { BlockType: 'LINE', Text: 'Hello', Confidence: 50 },
            { BlockType: 'LINE', Text: 'World', Confidence: 100 },
            { BlockType: 'LINE', Text: 'Low', Confidence: 0 },
          ],
        });

      const result = await adapter.extractText('my-job/image.jpg');

      expect(result.blocks).toEqual([
        { text: 'Hello', confidence: 0.5 },
        { text: 'World', confidence: 1.0 },
        { text: 'Low', confidence: 0 },
      ]);
    });

    it('throws when Textract job fails', async () => {
      sendMock
        .mockResolvedValueOnce({ JobId: 'job-123' })
        .mockResolvedValueOnce({
          JobStatus: 'FAILED',
          StatusMessage: 'Invalid document format',
        });

      await expect(adapter.extractText('my-job/bad.jpg')).rejects.toThrow(
        'Textract job job-123 failed: Invalid document format',
      );
    });

    it('throws when StartDocumentTextDetection returns no JobId', async () => {
      sendMock.mockResolvedValueOnce({});

      await expect(adapter.extractText('my-job/image.jpg')).rejects.toThrow(
        'Textract did not return a JobId',
      );
    });

    it('handles blocks with missing Text and Confidence gracefully', async () => {
      sendMock
        .mockResolvedValueOnce({ JobId: 'job-123' })
        .mockResolvedValueOnce({
          JobStatus: 'SUCCEEDED',
          Blocks: [
            { BlockType: 'LINE' },
            { BlockType: 'LINE', Text: 'Has text' },
          ],
        });

      const result = await adapter.extractText('my-job/image.jpg');

      expect(result.blocks).toEqual([
        { text: '', confidence: 0 },
        { text: 'Has text', confidence: 0 },
      ]);
    });
  });
});
