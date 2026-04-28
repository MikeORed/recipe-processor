import { HeirloomError } from '../../shared/errors.js';
import { JobService } from '../../domain/services/job-service.js';
import { IngestService } from '../../domain/services/ingest-service.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import type { CommandHandler } from './types.js';

export const ingestHandler: CommandHandler = async (_args: string[]) => {
  try {
    const fs = new NodeFileSystemAdapter();
    const jobService = new JobService(fs, 'jobs');
    const ingestService = new IngestService(fs);

    const activeJob = await jobService.getActiveJob();
    if (!activeJob) {
      console.error("No active job selected. Run 'heirloom use <job-name>' first");
      process.exitCode = 1;
      return;
    }

    const jobDir = `jobs/${activeJob}`;
    const { discovered, total } = await ingestService.ingest(jobDir);
    console.log(`Manifest updated: ${discovered} new image(s) discovered, ${total} total entries`);
  } catch (error: unknown) {
    if (error instanceof HeirloomError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
};
