import fc from 'fast-check';
import { JobService } from './job-service.js';
import type { FileSystemPort } from '../ports/file-system-port.js';
import { HeirloomError } from '../../shared/errors.js';

// Feature: cli-commands-implementation, Properties 2–6: JobService correctness

/** Arbitrary that produces valid job-name first characters. */
const firstCharArb = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''));

/** Arbitrary that produces valid job-name tail characters. */
const tailCharArb = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split(''));

/** Arbitrary that produces valid job names (1–128 chars). */
const validJobNameArb = fc
  .tuple(
    firstCharArb,
    fc.array(tailCharArb, { minLength: 0, maxLength: 127 }),
  )
  .map(([first, rest]) => first + rest.join(''))
  .filter((s) => s.length <= 128);

/**
 * Creates a mock FileSystemPort that records calls and returns configurable responses.
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

describe('JobService (property-based)', () => {
  // **Validates: Requirements 2.1, 2.2, 2.5, 3.4, 4.1, 4.2, 4.5**

  describe('Property 2: Init creates the correct directory structure', () => {
    it('createJob calls createDirectory with jobs/<name>/images for any valid name', async () => {
      await fc.assert(
        fc.asyncProperty(validJobNameArb, async (name) => {
          const mockFs = createMockFs({
            existsMap: { [`jobs/${name}`]: false },
          });
          const service = new JobService(mockFs, 'jobs');

          await service.createJob(name);

          const createDirCalls = mockFs.calls.filter((c) => c.method === 'createDirectory');
          expect(createDirCalls).toHaveLength(1);
          expect(createDirCalls[0].args[0]).toBe(`jobs/${name}/images`);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 3: Init rejects duplicate jobs', () => {
    it('createJob throws HeirloomError when job directory already exists', async () => {
      await fc.assert(
        fc.asyncProperty(validJobNameArb, async (name) => {
          const mockFs = createMockFs({
            existsMap: { [`jobs/${name}`]: true },
          });
          const service = new JobService(mockFs, 'jobs');

          await expect(service.createJob(name)).rejects.toThrow(HeirloomError);

          const createDirCalls = mockFs.calls.filter((c) => c.method === 'createDirectory');
          expect(createDirCalls).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 4: Job status derivation from filesystem state', () => {
    /**
     * Arbitrary for filesystem state of a single job:
     * - hasManifest: whether manifest.csv exists
     * - hasImages: whether images/ directory exists
     */
    const fsStateArb = fc.record({
      hasManifest: fc.boolean(),
      hasImages: fc.boolean(),
    });

    it('derives correct status from filesystem state for any job', async () => {
      await fc.assert(
        fc.asyncProperty(validJobNameArb, fsStateArb, async (name, state) => {
          const existsMap: Record<string, boolean> = {
            jobs: true,
            [`jobs/${name}/manifest.csv`]: state.hasManifest,
            [`jobs/${name}/images`]: state.hasImages,
          };

          const mockFs = createMockFs({
            existsMap,
            listDirectoryMap: { jobs: [name] },
          });
          const service = new JobService(mockFs, 'jobs');

          const jobs = await service.listJobs();
          expect(jobs).toHaveLength(1);

          const job = jobs[0];
          if (state.hasManifest) {
            expect(job.status).toBe('ingested');
          } else if (state.hasImages) {
            expect(job.status).toBe('initialized');
          } else {
            expect(job.status).toBe('empty');
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 5: Use command persists active job', () => {
    it('setActiveJob writes the job name to .active-job', async () => {
      await fc.assert(
        fc.asyncProperty(validJobNameArb, async (name) => {
          const writtenFiles: Record<string, string> = {};
          const mockFs = createMockFs({
            existsMap: { [`jobs/${name}`]: true },
          });
          // Override writeFile to capture written content
          mockFs.writeFile = async (path: string, content: string) => {
            mockFs.calls.push({ method: 'writeFile', args: [path, content] });
            writtenFiles[path] = content;
          };

          const service = new JobService(mockFs, 'jobs');
          await service.setActiveJob(name);

          expect(writtenFiles['jobs/.active-job']).toBe(name);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 6: Use command rejects non-existent jobs', () => {
    it('setActiveJob throws HeirloomError when job directory does not exist', async () => {
      await fc.assert(
        fc.asyncProperty(validJobNameArb, async (name) => {
          const mockFs = createMockFs({
            existsMap: { [`jobs/${name}`]: false },
          });
          const service = new JobService(mockFs, 'jobs');

          await expect(service.setActiveJob(name)).rejects.toThrow(HeirloomError);

          const writeCalls = mockFs.calls.filter((c) => c.method === 'writeFile');
          expect(writeCalls).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });
});
