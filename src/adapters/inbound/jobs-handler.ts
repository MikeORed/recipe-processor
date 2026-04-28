import { JobService } from '../../domain/services/job-service.js';
import { NodeFileSystemAdapter } from '../outbound/node-file-system-adapter.js';
import type { CommandHandler } from './types.js';

export const jobsHandler: CommandHandler = async (_args: string[]) => {
  const fs = new NodeFileSystemAdapter();
  const jobService = new JobService(fs, 'jobs');

  let jobs;
  try {
    jobs = await jobService.listJobs();
  } catch {
    console.log('No jobs found. Run "heirloom init <job-name>" to create one.');
    return;
  }

  if (jobs.length === 0) {
    console.log('No jobs found. Run "heirloom init <job-name>" to create one.');
    return;
  }

  for (const job of jobs) {
    const active = job.isActive ? ' (active)' : '';
    console.log(`  ${job.name}  [${job.status}]${active}`);
  }
};
