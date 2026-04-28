import { HeirloomError } from '../../shared/errors.js';
import { JobService } from '../../domain/services/job-service.js';
import { TranscribeService } from '../../domain/services/transcribe-service.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import { S3Adapter } from '../outbound/s3-adapter.js';
import { TextractAdapter } from '../outbound/textract-adapter.js';
import { BedrockAdapter } from '../outbound/bedrock-adapter.js';
import { DynamoDBAdapter } from '../outbound/dynamodb-adapter.js';
import { parseManifest } from '../../domain/services/csv-utils.js';
import type { CommandHandler } from './types.js';

export const transcribeHandler: CommandHandler = async (_args: string[]) => {
  try {
    const fs = new NodeFileSystemAdapter();
    const jobService = new JobService(fs, 'jobs');

    const activeJob = await jobService.getActiveJob();
    if (!activeJob) {
      console.error("No active job selected. Run 'heirloom use <job-name>' first");
      process.exitCode = 1;
      return;
    }

    const jobDir = `jobs/${activeJob}`;

    // Derive status from filesystem: manifest.csv exists means at least ingested
    const hasManifest = await fs.exists(`${jobDir}/manifest.csv`);
    if (!hasManifest) {
      console.error(`Job '${activeJob}' must be ingested first. Run 'heirloom ingest' first`);
      process.exitCode = 1;
      return;
    }

    // Read manifest to get recipe group count for progress reporting
    const manifestCsv = await fs.readFile(`${jobDir}/manifest.csv`);
    const entries = parseManifest(manifestCsv);
    const annotated = entries.filter((e) => e.recipeNumber.trim() !== '');
    const recipeNumbers = new Set(annotated.map((e) => e.recipeNumber));
    const groupCount = recipeNumbers.size;

    console.log(`Transcribing job '${activeJob}': ${groupCount} recipe group(s) to process`);

    const s3 = new S3Adapter();
    const textract = new TextractAdapter();
    const bedrock = new BedrockAdapter();
    const dynamodb = new DynamoDBAdapter();
    const transcribeService = new TranscribeService(fs, s3, textract, bedrock, dynamodb);

    const onProgress = (recipeNumber: string, index: number, total: number): void => {
      console.log(`  [${index}/${total}] Processing recipe group '${recipeNumber}'`);
    };

    const result = await transcribeService.transcribe(activeJob, jobDir, onProgress);

    const elapsedSeconds = (result.elapsedMs / 1000).toFixed(1);
    console.log(
      `Done: ${result.recipesTranscribed} recipe(s) transcribed, ${result.entriesSkipped} entry(ies) skipped, ${elapsedSeconds}s elapsed`,
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
