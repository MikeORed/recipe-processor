import { jobsHandler } from './jobs-handler.js';
import { JobService } from '../../domain/services/job-service.js';
import type { Job } from '../../domain/models/index.js';

jest.mock('../../domain/services/job-service.js');
jest.mock('../outbound/node-file-system-adapter.js');

const MockJobService = JobService as jest.MockedClass<typeof JobService>;

describe('jobsHandler', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('lists jobs with name, status, and active indicator', async () => {
    const jobs: Job[] = [
      { name: 'grandma-cards', status: 'ingested', isActive: true },
      { name: 'cookbook-2024', status: 'initialized', isActive: false },
      { name: 'new-batch', status: 'empty', isActive: false },
    ];
    MockJobService.prototype.listJobs.mockResolvedValue(jobs);

    await jobsHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith('  grandma-cards  [ingested] (active)');
    expect(stdoutSpy).toHaveBeenCalledWith('  cookbook-2024  [initialized]');
    expect(stdoutSpy).toHaveBeenCalledWith('  new-batch  [empty]');
  });

  it('prints no-jobs message when no jobs exist', async () => {
    MockJobService.prototype.listJobs.mockResolvedValue([]);

    await jobsHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      'No jobs found. Run "heirloom init <job-name>" to create one.',
    );
  });

  it('prints no-jobs message when jobs directory does not exist', async () => {
    MockJobService.prototype.listJobs.mockRejectedValue(
      new Error('ENOENT: no such file or directory'),
    );

    await jobsHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      'No jobs found. Run "heirloom init <job-name>" to create one.',
    );
  });

  it('shows active indicator only on the active job', async () => {
    const jobs: Job[] = [
      { name: 'job-a', status: 'initialized', isActive: false },
      { name: 'job-b', status: 'ingested', isActive: true },
    ];
    MockJobService.prototype.listJobs.mockResolvedValue(jobs);

    await jobsHandler([]);

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('  job-a  [initialized]');
    expect(calls).toContain('  job-b  [ingested] (active)');
  });
});
