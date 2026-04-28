import { HeirloomError } from '../../shared/errors.js';
import { JobService } from '../../domain/services/job-service.js';
import { ExportService } from '../../domain/services/export-service.js';
import { DynamoDBAdapter } from '../outbound/dynamodb-adapter.js';
import { PdfKitAdapter } from '../outbound/pdfkit-adapter.js';
import { ObsidianVaultAdapter } from '../outbound/obsidian-vault-adapter.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import type { CommandHandler } from './types.js';
import type { ExportFormat } from '../../domain/services/export-service.js';

const VALID_FORMATS: ExportFormat[] = ['pdf', 'obsidian'];

export const exportHandler: CommandHandler = async (args: string[]) => {
  try {
    // Parse format argument
    const formatArg = args[0];

    if (!formatArg) {
      console.log('Usage: heirloom export <format> [--job <name>]');
      console.log(`Available formats: ${VALID_FORMATS.join(', ')}`);
      return;
    }

    if (!VALID_FORMATS.includes(formatArg as ExportFormat)) {
      console.error(
        `Unknown format '${formatArg}'. Valid formats: ${VALID_FORMATS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }

    const format = formatArg as ExportFormat;

    // Parse optional --job flag
    const jobFlagIndex = args.indexOf('--job');
    const jobFlagValue = jobFlagIndex !== -1 ? args[jobFlagIndex + 1] : undefined;

    // Resolve job name
    let jobName: string | undefined = jobFlagValue;

    if (!jobName) {
      const fs = new NodeFileSystemAdapter();
      const jobService = new JobService(fs, 'jobs');
      jobName = await jobService.getActiveJob();

      if (!jobName) {
        console.error("No active job selected. Run 'heirloom use <job-name>' first, or pass --job <name>");
        process.exitCode = 1;
        return;
      }
    }

    // Construct output path
    const outputPath =
      format === 'pdf'
        ? `./exports/${jobName}/${jobName}.pdf`
        : `./exports/${jobName}/vault/`;

    // Wire up adapters
    const nodeFs = new NodeFileSystemAdapter();
    const dataStore = new DynamoDBAdapter();
    const pdfRenderer = new PdfKitAdapter();
    const markdownRenderer = new ObsidianVaultAdapter(nodeFs);
    const exportService = new ExportService(dataStore, pdfRenderer, markdownRenderer);

    // Invoke export
    const result = await exportService.export(jobName, format, outputPath);

    // Print warnings
    for (const warning of result.warnings) {
      console.warn(warning);
    }

    // Print summary
    console.log(
      `Exported ${result.recipeCount} recipe(s) to ${result.outputPath}`,
    );
  } catch (error: unknown) {
    if (error instanceof HeirloomError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
};
