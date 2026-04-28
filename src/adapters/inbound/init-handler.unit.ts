import { initHandler } from './init-handler.js';
import { JobService } from '../../domain/services/job-service.js';
import { HeirloomError } from '../../shared/errors.js';

jest.mock('../../domain/services/job-service.js');
jest.mock('../outbound/node-file-system-adapter.js');

const MockJobService = JobService as jest.MockedClass<typeof JobService>;

describe('initHandler', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
    stderrSpy = jest.spyOn(console, 'error').mockImplementation();
    process.exitCode = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('prints confirmation message on successful job creation', async () => {
    MockJobService.prototype.createJob.mockResolvedValue(undefined);

    await initHandler(['my-recipes']);

    expect(MockJobService.prototype.createJob).toHaveBeenCalledWith('my-recipes');
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Job 'my-recipes' created. Add images to jobs/my-recipes/images/",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prints error and sets exit code when job name is missing', async () => {
    await initHandler([]);

    expect(stderrSpy).toHaveBeenCalledWith(
      'Job name is required. Usage: heirloom init <job-name>',
    );
    expect(process.exitCode).toBe(1);
    expect(MockJobService.prototype.createJob).not.toHaveBeenCalled();
  });

  it('prints error and sets exit code when job already exists', async () => {
    MockJobService.prototype.createJob.mockRejectedValue(
      new HeirloomError("Job 'my-recipes' already exists"),
    );

    await initHandler(['my-recipes']);

    expect(stderrSpy).toHaveBeenCalledWith("Job 'my-recipes' already exists");
    expect(process.exitCode).toBe(1);
  });

  it('prints error and sets exit code for invalid job name', async () => {
    MockJobService.prototype.createJob.mockRejectedValue(
      new HeirloomError(
        'Invalid job name: Job name must be lowercase alphanumeric, hyphens, underscores, and start with a letter or digit',
      ),
    );

    await initHandler(['INVALID NAME']);

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid job name'));
    expect(process.exitCode).toBe(1);
  });

  it('re-throws non-HeirloomError errors', async () => {
    MockJobService.prototype.createJob.mockRejectedValue(new Error('unexpected'));

    await expect(initHandler(['my-recipes'])).rejects.toThrow('unexpected');
  });
});
