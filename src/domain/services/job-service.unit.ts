import { JobService } from './job-service.js';
import type { FileSystemPort } from '../ports/file-system-port.js';
import { HeirloomError } from '../../shared/errors.js';

/**
 * Creates a mock FileSystemPort with configurable responses.
 */
function createMockFs(overrides: {
  existsMap?: Record<string, boolean>;
  listDirectoryMap?: Record<string, string[]>;
  readFileMap?: Record<string, string>;
} = {}): FileSystemPort & {
  calls: { method: string; args: unknown[] }[];
} {
  const { existsMap = {}, listDirectoryMap = {}, readFileMap = {} } = overrides;
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    calls,
    async createDirectory(path: string): Promise<void> {
      calls.push({ method: 'createDirectory', args: [path] });
    },
    async exists(path: string): Promise<boolean> {
      calls.push({ method: 'exists', args: [path] });
      return existsMap[path] ?? false;
    },
    async getFileModifiedTime(path: string): Promise<Date> {
      calls.push({ method: 'getFileModifiedTime', args: [path] });
      return new Date();
    },
    async listDirectory(path: string): Promise<string[]> {
      calls.push({ method: 'listDirectory', args: [path] });
      return listDirectoryMap[path] ?? [];
    },
    async readFile(path: string): Promise<string> {
      calls.push({ method: 'readFile', args: [path] });
      return readFileMap[path] ?? '';
    },
    async writeFile(path: string, content: string): Promise<void> {
      calls.push({ method: 'writeFile', args: [path, content] });
    },
  };
}

describe('JobService', () => {
  describe('validateJobName', () => {
    it.each([
      'a',
      'my-job',
      'job123',
      '0-start-with-digit',
      'a_b_c',
    ])('accepts valid name: %s', (name) => {
      const service = new JobService(createMockFs(), 'jobs');
      expect(() => service.validateJobName(name)).not.toThrow();
    });

    it('rejects empty string', () => {
      const service = new JobService(createMockFs(), 'jobs');
      expect(() => service.validateJobName('')).toThrow(HeirloomError);
      expect(() => service.validateJobName('')).toThrow(/Invalid job name/);
    });

    it('rejects name exceeding 128 characters', () => {
      const service = new JobService(createMockFs(), 'jobs');
      expect(() => service.validateJobName('a'.repeat(129))).toThrow(HeirloomError);
    });

    it.each([
      'MyJob',
      'has Space',
      '-leading-hyphen',
      '_leading-underscore',
      'hello!world',
    ])('rejects invalid name: %s', (name) => {
      const service = new JobService(createMockFs(), 'jobs');
      expect(() => service.validateJobName(name)).toThrow(HeirloomError);
    });
  });

  describe('createJob', () => {
    it('creates job directory structure for a valid new job', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/my-job': false },
      });
      const service = new JobService(mockFs, 'jobs');

      await service.createJob('my-job');

      const createDirCalls = mockFs.calls.filter((c) => c.method === 'createDirectory');
      expect(createDirCalls).toHaveLength(1);
      expect(createDirCalls[0].args[0]).toBe('jobs/my-job/images');
    });

    it('throws HeirloomError when job already exists', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/existing-job': true },
      });
      const service = new JobService(mockFs, 'jobs');

      await expect(service.createJob('existing-job')).rejects.toThrow(HeirloomError);
      await expect(service.createJob('existing-job')).rejects.toThrow("Job 'existing-job' already exists");
    });

    it('throws HeirloomError for invalid job name before checking filesystem', async () => {
      const mockFs = createMockFs();
      const service = new JobService(mockFs, 'jobs');

      await expect(service.createJob('INVALID')).rejects.toThrow(HeirloomError);

      // Should not have called exists or createDirectory
      expect(mockFs.calls).toHaveLength(0);
    });
  });

  describe('listJobs', () => {
    it('returns empty array when jobs directory does not exist', async () => {
      const mockFs = createMockFs({
        existsMap: { jobs: false },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs).toEqual([]);
    });

    it('returns empty array when jobs directory is empty', async () => {
      const mockFs = createMockFs({
        existsMap: { jobs: true },
        listDirectoryMap: { jobs: [] },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs).toEqual([]);
    });

    it('skips hidden files like .active-job', async () => {
      const mockFs = createMockFs({
        existsMap: {
          jobs: true,
          'jobs/my-job/manifest.csv': false,
          'jobs/my-job/images': true,
        },
        listDirectoryMap: { jobs: ['.active-job', 'my-job'] },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('my-job');
    });

    it('derives status "ingested" when manifest.csv exists', async () => {
      const mockFs = createMockFs({
        existsMap: {
          jobs: true,
          'jobs/batch1/manifest.csv': true,
        },
        listDirectoryMap: { jobs: ['batch1'] },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs[0].status).toBe('ingested');
    });

    it('derives status "initialized" when images/ exists but no manifest.csv', async () => {
      const mockFs = createMockFs({
        existsMap: {
          jobs: true,
          'jobs/batch1/manifest.csv': false,
          'jobs/batch1/images': true,
        },
        listDirectoryMap: { jobs: ['batch1'] },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs[0].status).toBe('initialized');
    });

    it('derives status "empty" when neither manifest.csv nor images/ exist', async () => {
      const mockFs = createMockFs({
        existsMap: {
          jobs: true,
          'jobs/batch1/manifest.csv': false,
          'jobs/batch1/images': false,
        },
        listDirectoryMap: { jobs: ['batch1'] },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs[0].status).toBe('empty');
    });

    it('lists multiple jobs with mixed statuses', async () => {
      const mockFs = createMockFs({
        existsMap: {
          jobs: true,
          'jobs/alpha/manifest.csv': true,
          'jobs/beta/manifest.csv': false,
          'jobs/beta/images': true,
          'jobs/gamma/manifest.csv': false,
          'jobs/gamma/images': false,
        },
        listDirectoryMap: { jobs: ['alpha', 'beta', 'gamma'] },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs).toEqual([
        { name: 'alpha', status: 'ingested', isActive: false },
        { name: 'beta', status: 'initialized', isActive: false },
        { name: 'gamma', status: 'empty', isActive: false },
      ]);
    });

    it('marks the active job correctly', async () => {
      const mockFs = createMockFs({
        existsMap: {
          jobs: true,
          'jobs/.active-job': true,
          'jobs/alpha/manifest.csv': false,
          'jobs/alpha/images': true,
          'jobs/beta/manifest.csv': false,
          'jobs/beta/images': true,
        },
        listDirectoryMap: { jobs: ['alpha', 'beta'] },
        readFileMap: { 'jobs/.active-job': 'beta' },
      });
      const service = new JobService(mockFs, 'jobs');

      const jobs = await service.listJobs();
      expect(jobs).toEqual([
        { name: 'alpha', status: 'initialized', isActive: false },
        { name: 'beta', status: 'initialized', isActive: true },
      ]);
    });
  });

  describe('getActiveJob', () => {
    it('returns undefined when .active-job does not exist', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/.active-job': false },
      });
      const service = new JobService(mockFs, 'jobs');

      const result = await service.getActiveJob();
      expect(result).toBeUndefined();
    });

    it('returns the job name when .active-job exists', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/.active-job': true },
        readFileMap: { 'jobs/.active-job': 'my-job' },
      });
      const service = new JobService(mockFs, 'jobs');

      const result = await service.getActiveJob();
      expect(result).toBe('my-job');
    });

    it('trims whitespace from .active-job content', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/.active-job': true },
        readFileMap: { 'jobs/.active-job': '  my-job  \n' },
      });
      const service = new JobService(mockFs, 'jobs');

      const result = await service.getActiveJob();
      expect(result).toBe('my-job');
    });

    it('returns undefined when .active-job is empty', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/.active-job': true },
        readFileMap: { 'jobs/.active-job': '' },
      });
      const service = new JobService(mockFs, 'jobs');

      const result = await service.getActiveJob();
      expect(result).toBeUndefined();
    });
  });

  describe('setActiveJob', () => {
    it('writes job name to .active-job when job exists', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/my-job': true },
      });
      const service = new JobService(mockFs, 'jobs');

      await service.setActiveJob('my-job');

      const writeCalls = mockFs.calls.filter((c) => c.method === 'writeFile');
      expect(writeCalls).toHaveLength(1);
      expect(writeCalls[0].args).toEqual(['jobs/.active-job', 'my-job']);
    });

    it('throws HeirloomError when job does not exist', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/nonexistent': false },
      });
      const service = new JobService(mockFs, 'jobs');

      await expect(service.setActiveJob('nonexistent')).rejects.toThrow(HeirloomError);
      await expect(service.setActiveJob('nonexistent')).rejects.toThrow("Job 'nonexistent' not found");
    });

    it('throws HeirloomError for invalid job name', async () => {
      const mockFs = createMockFs();
      const service = new JobService(mockFs, 'jobs');

      await expect(service.setActiveJob('INVALID')).rejects.toThrow(HeirloomError);

      // Should not have called exists or writeFile
      expect(mockFs.calls).toHaveLength(0);
    });

    it('overwrites previously set active job', async () => {
      const mockFs = createMockFs({
        existsMap: { 'jobs/job-a': true, 'jobs/job-b': true },
      });
      const service = new JobService(mockFs, 'jobs');

      await service.setActiveJob('job-a');
      await service.setActiveJob('job-b');

      const writeCalls = mockFs.calls.filter((c) => c.method === 'writeFile');
      expect(writeCalls).toHaveLength(2);
      expect(writeCalls[1].args).toEqual(['jobs/.active-job', 'job-b']);
    });
  });
});
