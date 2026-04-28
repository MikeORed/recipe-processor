import { exportHandler } from './export-handler.js';
import { JobService } from '../../domain/services/job-service.js';
import { ExportService } from '../../domain/services/export-service.js';
import { HeirloomError } from '../../shared/errors.js';

jest.mock('../../domain/services/job-service.js');
jest.mock('../../domain/services/export-service.js');
jest.mock('../outbound/node-file-system-adapter.js');
jest.mock('../outbound/dynamodb-adapter.js', () => ({
  DynamoDBAdapter: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../outbound/pdfkit-adapter.js', () => ({
  PdfKitAdapter: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../outbound/obsidian-vault-adapter.js', () => ({
  ObsidianVaultAdapter: jest.fn().mockImplementation(() => ({})),
}));

const MockJobService = JobService as jest.MockedClass<typeof JobService>;
const MockExportService = ExportService as jest.MockedClass<typeof ExportService>;

describe('exportHandler', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
    stderrSpy = jest.spyOn(console, 'error').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    process.exitCode = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    warnSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('prints usage when no format argument is provided', async () => {
    await exportHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      'Usage: heirloom export <format> [--job <name>]',
    );
    expect(stdoutSpy).toHaveBeenCalledWith('Available formats: pdf, obsidian');
    expect(process.exitCode).toBeUndefined();
    expect(MockExportService.prototype.export).not.toHaveBeenCalled();
  });

  it('prints error for unrecognized format', async () => {
    await exportHandler(['csv']);

    expect(stderrSpy).toHaveBeenCalledWith(
      "Unknown format 'csv'. Valid formats: pdf, obsidian",
    );
    expect(process.exitCode).toBe(1);
    expect(MockExportService.prototype.export).not.toHaveBeenCalled();
  });

  it('parses pdf format and uses active job', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('grandma-cards');
    MockExportService.prototype.export.mockResolvedValue({
      recipeCount: 5,
      outputPath: './exports/grandma-cards/grandma-cards.pdf',
      warnings: [],
    });

    await exportHandler(['pdf']);

    expect(MockExportService.prototype.export).toHaveBeenCalledWith(
      'grandma-cards',
      'pdf',
      './exports/grandma-cards/grandma-cards.pdf',
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Exported 5 recipe(s) to ./exports/grandma-cards/grandma-cards.pdf',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('parses obsidian format and uses active job', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('grandma-cards');
    MockExportService.prototype.export.mockResolvedValue({
      recipeCount: 3,
      outputPath: './exports/grandma-cards/vault/',
      warnings: [],
    });

    await exportHandler(['obsidian']);

    expect(MockExportService.prototype.export).toHaveBeenCalledWith(
      'grandma-cards',
      'obsidian',
      './exports/grandma-cards/vault/',
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Exported 3 recipe(s) to ./exports/grandma-cards/vault/',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('resolves --job flag override instead of active job', async () => {
    MockExportService.prototype.export.mockResolvedValue({
      recipeCount: 2,
      outputPath: './exports/holiday-baking/holiday-baking.pdf',
      warnings: [],
    });

    await exportHandler(['pdf', '--job', 'holiday-baking']);

    expect(MockExportService.prototype.export).toHaveBeenCalledWith(
      'holiday-baking',
      'pdf',
      './exports/holiday-baking/holiday-baking.pdf',
    );
    expect(MockJobService.prototype.getActiveJob).not.toHaveBeenCalled();
  });

  it('prints error when no active job and no --job flag', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue(undefined);

    await exportHandler(['pdf']);

    expect(stderrSpy).toHaveBeenCalledWith(
      "No active job selected. Run 'heirloom use <job-name>' first, or pass --job <name>",
    );
    expect(process.exitCode).toBe(1);
    expect(MockExportService.prototype.export).not.toHaveBeenCalled();
  });

  it('prints summary on success with recipe count and output path', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-recipes');
    MockExportService.prototype.export.mockResolvedValue({
      recipeCount: 10,
      outputPath: './exports/my-recipes/vault/',
      warnings: [],
    });

    await exportHandler(['obsidian']);

    expect(stdoutSpy).toHaveBeenCalledWith(
      'Exported 10 recipe(s) to ./exports/my-recipes/vault/',
    );
  });

  it('prints warnings from ExportService', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-recipes');
    MockExportService.prototype.export.mockResolvedValue({
      recipeCount: 3,
      outputPath: './exports/my-recipes/my-recipes.pdf',
      warnings: ["Job 'my-recipes' has status 'ingested' — export may be incomplete"],
    });

    await exportHandler(['pdf']);

    expect(warnSpy).toHaveBeenCalledWith(
      "Job 'my-recipes' has status 'ingested' — export may be incomplete",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Exported 3 recipe(s) to ./exports/my-recipes/my-recipes.pdf',
    );
  });

  it('catches HeirloomError and prints to stderr with exit code 1', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-recipes');
    MockExportService.prototype.export.mockRejectedValue(
      new HeirloomError("No recipes found for job 'my-recipes'"),
    );

    await exportHandler(['pdf']);

    expect(stderrSpy).toHaveBeenCalledWith("No recipes found for job 'my-recipes'");
    expect(process.exitCode).toBe(1);
  });

  it('re-throws non-HeirloomError errors', async () => {
    MockJobService.prototype.getActiveJob.mockResolvedValue('my-recipes');
    MockExportService.prototype.export.mockRejectedValue(new Error('network failure'));

    await expect(exportHandler(['pdf'])).rejects.toThrow('network failure');
  });
});
