const sendMock = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'PutObjectCommand', input })),
  HeadObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'HeadObjectCommand', input })),
}));

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('image-bytes')),
}));

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Adapter } from './s3-adapter.js';
import config from '../../config/config.js';

describe('S3Adapter', () => {
  let adapter: S3Adapter;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMock.mockResolvedValue({});
    adapter = new S3Adapter();
  });

  describe('constructor', () => {
    it('reads region and bucket name from convict config', () => {
      expect(S3Client).toHaveBeenCalledWith({
        region: config.get('aws.region'),
      });
    });
  });

  describe('upload', () => {
    it('sends PutObjectCommand with correct bucket, key, and body', async () => {
      await adapter.upload('/local/path/image.jpg', 'my-job/image.jpg');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: config.get('s3.bucketName'),
        Key: 'my-job/image.jpg',
        Body: Buffer.from('image-bytes'),
      });
    });
  });

  describe('exists', () => {
    it('returns true when HeadObject succeeds', async () => {
      sendMock.mockResolvedValue({});

      const result = await adapter.exists('my-job/image.jpg');

      expect(result).toBe(true);
      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: config.get('s3.bucketName'),
        Key: 'my-job/image.jpg',
      });
    });

    it('returns false when HeadObject throws NotFound', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      sendMock.mockRejectedValue(notFoundError);

      const result = await adapter.exists('my-job/missing.jpg');

      expect(result).toBe(false);
    });

    it('re-throws non-NotFound errors', async () => {
      const accessDenied = new Error('Access Denied');
      accessDenied.name = 'AccessDenied';
      sendMock.mockRejectedValue(accessDenied);

      await expect(adapter.exists('my-job/image.jpg')).rejects.toThrow('Access Denied');
    });
  });
});
