import { transcribeHandler } from './transcribe-handler.js';
import { JobService } from '../../domain/services/job-service.js';
import { TranscribeService } from '../../domain/services/transcribe-service.js';
import { HeirloomError } from '../../shared/errors.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';

jest.mock('../../domain/services/job-service.js');
jest.mock('../../domain/services/transcribe-service.js');
jest.mock('../../domain/services/csv-utils.js', () => ({
  parseManifest: jest.fn(),
}));
jest.mock('../outbound/node-file-system-adapter.js');
jest.mock('../outbound/s3-adapter.js', () => ({
  S3Adapter: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../outbound/textract-adapter.js', () => ({
  TextractAdapter: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../outbound/bedrock-adapter.js', () => ({
  BedrockAdapter: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../outbound/dynamodb-adapter.js', () => ({
  DynamoDBAdapter: jest.fn().mockImplementation(() => ({})),
}));

const MockJobService = JobService as jest.MockedClass<typeof JobService>;
const MockTranscribeService = TranscribeService as jest.MockedClass<typeof TranscribeService>;
const MockNodeFs = NodeFileSystemAdapter as jest.MockedClass<typeof NodeFileSystemAdapter>;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseManifest } = jest.requireMock('../../domain/services/csv-utils.js') as {
  parseManifest: jest.Mock;
};

describe('transcribeHandler', () => {
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

  it('prints error when no active job is set', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue(undefined);

    await transcribeHandler([]);

    expect(stderrSpy).toHaveBeenCalledWith(
      "No active job selected. Run 'heirloom use <job-name>' first",
    );
    expect(process.exitCode).toBe(1);
    expect(MockTranscribeService.prototype.transcribe).not.toHaveBeenCalled();
  });

  it('prints error when job is not ingested (no manifest.csv)', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-job');
    MockNodeFs.prototype.exists.mockResolvedValue(false);

    await transcribeHandler([]);

    expect(stderrSpy).toHaveBeenCalledWith(
      "Job 'my-job' must be ingested first. Run 'heirloom ingest' first",
    );
    expect(process.exitCode).toBe(1);
    expect(MockTranscribeService.prototype.transcribe).not.toHaveBeenCalled();
  });

  it('calls TranscribeService and prints progress and summary on success', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('grandma-cards');
    MockNodeFs.prototype.exists.mockResolvedValue(true);
    MockNodeFs.prototype.readFile.mockResolvedValue('csv-content');
    parseManifest.mockReturnValue([
      { file: 'a.jpg', modified: '2025-01-01', recipeNumber: '1', source: 'box1' },
      { file: 'b.jpg', modified: '2025-01-01', recipeNumber: '2', source: 'box1' },
      { file: 'c.jpg', modified: '2025-01-01', recipeNumber: '', source: '' },
    ]);

    MockTranscribeService.prototype.transcribe.mockResolvedValue({
      recipesTranscribed: 2,
      entriesSkipped: 1,
      elapsedMs: 5432,
      errors: [],
    });

    await transcribeHandler([]);

    // Should print job name and group count
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Transcribing job 'grandma-cards': 2 recipe group(s) to process",
    );

    // Should call transcribe with job name, dir, and a progress callback
    expect(MockTranscribeService.prototype.transcribe).toHaveBeenCalledWith(
      'grandma-cards',
      'jobs/grandma-cards',
      expect.any(Function),
    );

    // Should print summary
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Done: 2 recipe(s) transcribed, 1 entry(ies) skipped, 5.4s elapsed',
    );

    expect(process.exitCode).toBeUndefined();
  });

  it('prints error message and sets exit code 1 on HeirloomError from service', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-job');
    MockNodeFs.prototype.exists.mockResolvedValue(true);
    MockNodeFs.prototype.readFile.mockResolvedValue('csv-content');
    parseManifest.mockReturnValue([
      { file: 'a.jpg', modified: '2025-01-01', recipeNumber: '1', source: 'box1' },
    ]);

    MockTranscribeService.prototype.transcribe.mockRejectedValue(
      new HeirloomError('No annotated entries found in manifest. Annotate entries with a recipe number before transcribing.'),
    );

    await transcribeHandler([]);

    expect(stderrSpy).toHaveBeenCalledWith(
      'No annotated entries found in manifest. Annotate entries with a recipe number before transcribing.',
    );
    expect(process.exitCode).toBe(1);
  });

  it('re-throws non-HeirloomError errors', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-job');
    MockNodeFs.prototype.exists.mockResolvedValue(true);
    MockNodeFs.prototype.readFile.mockResolvedValue('csv-content');
    parseManifest.mockReturnValue([
      { file: 'a.jpg', modified: '2025-01-01', recipeNumber: '1', source: 'box1' },
    ]);

    MockTranscribeService.prototype.transcribe.mockRejectedValue(new Error('network failure'));

    await expect(transcribeHandler([])).rejects.toThrow('network failure');
  });
});
