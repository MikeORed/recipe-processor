import { HeirloomError } from '../../shared/errors.js';
import { JobService } from '../../domain/services/job-service.js';
import { ExportService } from '../../domain/services/export-service.js';
import { DynamoDBAdapter } from '../outbound/dynamodb-adapter.js';
import { PdfKitAdapter } from '../outbound/pdfkit-adapter.js';
import { ObsidianVaultAdapter } from '../outbound/obsidian-vault-adapter.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import type { CommandHandler } from './types.js';
import type { ExportFormat } from '../../domain/services/export-service.js';
import type { PdfRenderOptions, ImageMode, PageSize } from '../../domain/ports/pdf-renderer-port.js';

const VALID_FORMATS: ExportFormat[] = ['pdf', 'obsidian'];
const VALID_IMAGE_MODES: ImageMode[] = ['none', 'thumbnail', 'full'];
const VALID_PAGE_SIZES: PageSize[] = ['letter', 'a4'];

/**
 * Parses PDF-related CLI flags from the args array and returns a PdfRenderOptions object.
 * Returns null if any validation error occurs (after logging the error to stderr).
 * Does NOT set process.exitCode — the caller is responsible for that.
 */
export function parseExportOptions(args: string[]): PdfRenderOptions | null {
  let imageMode: ImageMode = 'thumbnail';
  let pageSize: PageSize = 'letter';
  let multiPerPage = true;
  let confidenceMarkers = true;
  let chapterGrouping = true;

  // Parse --images
  const imagesIndex = args.indexOf('--images');
  if (imagesIndex !== -1) {
    const value = args[imagesIndex + 1];
    if (!value || !VALID_IMAGE_MODES.includes(value as ImageMode)) {
      console.error(
        `Invalid value '${value ?? ''}' for --images. Valid values: ${VALID_IMAGE_MODES.join(', ')}`,
      );
      return null;
    }
    imageMode = value as ImageMode;
  }

  // Parse --page-size
  const pageSizeIndex = args.indexOf('--page-size');
  if (pageSizeIndex !== -1) {
    const value = args[pageSizeIndex + 1];
    if (!value || !VALID_PAGE_SIZES.includes(value as PageSize)) {
      console.error(
        `Invalid value '${value ?? ''}' for --page-size. Valid values: ${VALID_PAGE_SIZES.join(', ')}`,
      );
      return null;
    }
    pageSize = value as PageSize;
  }

  // Parse --multi-per-page
  const multiIndex = args.indexOf('--multi-per-page');
  if (multiIndex !== -1) {
    const nextArg = args[multiIndex + 1];
    if (nextArg === 'false') {
      multiPerPage = false;
    } else {
      multiPerPage = true;
    }
  }

  // Parse --confidence
  const confidenceIndex = args.indexOf('--confidence');
  if (confidenceIndex !== -1) {
    const nextArg = args[confidenceIndex + 1];
    if (nextArg === 'false') {
      confidenceMarkers = false;
    } else {
      confidenceMarkers = true;
    }
  }

  // Parse --no-chapters
  const noChaptersIndex = args.indexOf('--no-chapters');
  if (noChaptersIndex !== -1) {
    chapterGrouping = false;
  }

  return {
    imageMode,
    pageSize,
    multiPerPage,
    confidenceMarkers,
    chapterGrouping,
  };
}

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

    // Parse PDF render options
    const options = parseExportOptions(args);
    if (!options) {
      process.exitCode = 1;
      return;
    }

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
    const result = await exportService.export(jobName, format, outputPath, options);

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
