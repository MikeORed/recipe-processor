import { useHandler } from './use-handler.js';
import { JobService } from '../../domain/services/job-service.js';
import { HeirloomError } from '../../shared/errors.js';

jest.mock('../../domain/services/job-service.js');
jest.mock('../outbound/node-file-system-adapter.js');

const MockJobService = JobService as jest.MockedClass<typeof JobService>;

describe('useHandler', () => {
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

  it('prints confirmation message on successful job selection', async () => {
    MockJobService.prototype.setActiveJob.mockResolvedValue(undefined);

    await useHandler(['my-recipes']);

    expect(MockJobService.prototype.setActiveJob).toHaveBeenCalledWith('my-recipes');
    expect(stdoutSpy).toHaveBeenCalledWith("Now using job 'my-recipes'");
    expect(process.exitCode).toBeUndefined();
  });

  it('prints error and sets exit code when job name is missing', async () => {
    await useHandler([]);

    expect(stderrSpy).toHaveBeenCalledWith(
      'Job name is required. Usage: heirloom use <job-name>',
    );
    expect(process.exitCode).toBe(1);
    expect(MockJobService.prototype.setActiveJob).not.toHaveBeenCalled();
  });

  it('prints error and sets exit code when job does not exist', async () => {
    MockJobService.prototype.setActiveJob.mockRejectedValue(
      new HeirloomError("Job 'no-such-job' not found"),
    );

    await useHandler(['no-such-job']);

    expect(stderrSpy).toHaveBeenCalledWith("Job 'no-such-job' not found");
    expect(process.exitCode).toBe(1);
  });

  it('re-throws non-HeirloomError errors', async () => {
    MockJobService.prototype.setActiveJob.mockRejectedValue(new Error('unexpected'));

    await expect(useHandler(['my-recipes'])).rejects.toThrow('unexpected');
  });
});
