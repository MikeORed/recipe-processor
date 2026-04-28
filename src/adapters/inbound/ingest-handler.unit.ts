import { ingestHandler } from './ingest-handler.js';
import { JobService } from '../../domain/services/job-service.js';
import { IngestService } from '../../domain/services/ingest-service.js';
import { HeirloomError } from '../../shared/errors.js';

jest.mock('../../domain/services/job-service.js');
jest.mock('../../domain/services/ingest-service.js');
jest.mock('../outbound/node-file-system-adapter.js');

const MockJobService = JobService as jest.MockedClass<typeof JobService>;
const MockIngestService = IngestService as jest.MockedClass<typeof IngestService>;

describe('ingestHandler', () => {
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

  it('prints summary with discovered and total counts on success', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('grandma-cards');
    MockIngestService.prototype.ingest.mockResolvedValue({ discovered: 5, total: 12 });

    await ingestHandler([]);

    expect(MockIngestService.prototype.ingest).toHaveBeenCalledWith('jobs/grandma-cards');
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Manifest updated: 5 new image(s) discovered, 12 total entries',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prints error with suggestion when no active job is set', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue(undefined);

    await ingestHandler([]);

    expect(stderrSpy).toHaveBeenCalledWith(
      "No active job selected. Run 'heirloom use <job-name>' first",
    );
    expect(process.exitCode).toBe(1);
    expect(MockIngestService.prototype.ingest).not.toHaveBeenCalled();
  });

  it('prints error when no images are found', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('empty-job');
    MockIngestService.prototype.ingest.mockRejectedValue(
      new HeirloomError('No image files found in jobs/empty-job/images'),
    );

    await ingestHandler([]);

    expect(stderrSpy).toHaveBeenCalledWith(
      'No image files found in jobs/empty-job/images',
    );
    expect(process.exitCode).toBe(1);
  });

  it('re-throws non-HeirloomError errors', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-job');
    MockIngestService.prototype.ingest.mockRejectedValue(new Error('disk failure'));

    await expect(ingestHandler([])).rejects.toThrow('disk failure');
  });
});
