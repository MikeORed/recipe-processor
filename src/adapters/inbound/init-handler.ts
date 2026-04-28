import { HeirloomError } from '../../shared/errors.js';
import { JobService } from '../../domain/services/job-service.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import type { CommandHandler } from './types.js';

export const initHandler: CommandHandler = async (args: string[]) => {
  const name = args[0];

  if (!name) {
    console.error('Job name is required. Usage: heirloom init <job-name>');
    process.exitCode = 1;
    return;
  }

  try {
    const fs = new NodeFileSystemAdapter();
    const jobService = new JobService(fs, 'jobs');
    await jobService.createJob(name);
    console.log(`Job '${name}' created. Add images to jobs/${name}/images/`);
  } catch (error: unknown) {
    if (error instanceof HeirloomError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
};
