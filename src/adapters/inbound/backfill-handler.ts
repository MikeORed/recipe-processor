import { HeirloomError } from '../../shared/errors.js';
import { JobService } from '../../domain/services/job-service.js';
import { BackfillService } from '../../domain/services/backfill-service.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import { BedrockAdapter } from '../outbound/bedrock-adapter.js';
import { DynamoDBAdapter } from '../outbound/dynamodb-adapter.js';
import type { CommandHandler } from './types.js';

export const backfillHandler: CommandHandler = async (args: string[]) => {
  try {
    // Parse CLI args
    let jobName: string | undefined;
    let concurrency = 5;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--job' && i + 1 < args.length) {
        jobName = args[++i];
      } else if (args[i] === '--concurrency' && i + 1 < args.length) {
        const raw = args[++i];
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1) {
          console.error(`Invalid concurrency value '${raw}': must be a positive integer`);
          process.exitCode = 1;
          return;
        }
        concurrency = parsed;
      }
    }

    // Resolve job name from active job if not provided
    if (!jobName) {
      const fs = new NodeFileSystemAdapter();
      const jobService = new JobService(fs, 'jobs');
      const activeJob = await jobService.getActiveJob();
      if (!activeJob) {
        console.error(
          "No active job selected. Run 'heirloom use <job-name>' first or provide --job <name>",
        );
        process.exitCode = 1;
        return;
      }
      jobName = activeJob;
    }

    // Wire up adapters
    const dynamodb = new DynamoDBAdapter();
    const bedrock = new BedrockAdapter();
    const backfillService = new BackfillService(dynamodb, bedrock);

    console.log(`Backfilling job '${jobName}' with concurrency ${concurrency}...`);

    const result = await backfillService.backfill(jobName, concurrency);

    // Print summary
    console.log(
      `Done: ${result.successCount}/${result.totalProcessed} recipe(s) updated successfully`,
    );
    if (result.failedCount > 0) {
      console.log(`  ${result.failedCount} recipe(s) failed:`);
      for (const f of result.failures) {
        console.log(`    - Recipe ${f.recipeNumber}: ${f.error}`);
      }
    }
  } catch (error: unknown) {
    if (error instanceof HeirloomError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
};
