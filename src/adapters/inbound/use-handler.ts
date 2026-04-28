import { HeirloomError } from '../../shared/errors.js';
import { JobService } from '../../domain/services/job-service.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import type { CommandHandler } from './types.js';

export const useHandler: CommandHandler = async (args: string[]) => {
  const name = args[0];

  if (!name) {
    console.error('Job name is required. Usage: heirloom use <job-name>');
    process.exitCode = 1;
    return;
  }

  try {
    const fs = new NodeFileSystemAdapter();
    const jobService = new JobService(fs, 'jobs');
    await jobService.setActiveJob(name);
    console.log(`Now using job '${name}'`);
  } catch (error: unknown) {
    if (error instanceof HeirloomError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
};
