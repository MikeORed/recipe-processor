import type { FileSystemPort } from '../ports/file-system-port.js';
import type { Job } from '../models/index.js';
import { jobNameSchema } from '../models/index.js';
import { HeirloomError } from '../../shared/errors.js';

export class JobService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly jobsRoot: string = 'jobs',
  ) {}

  /**
   * Validate a job name against the schema. Throws HeirloomError on failure.
   */
  validateJobName(name: string): void {
    const result = jobNameSchema.safeParse(name);
    if (!result.success) {
      throw new HeirloomError(`Invalid job name: ${result.error.issues[0].message}`);
    }
  }

  /**
   * Create a new job workspace with the given name.
   * Creates `jobs/<name>/images/` directory structure.
   * Throws if the job already exists or the name is invalid.
   */
  async createJob(name: string): Promise<void> {
    this.validateJobName(name);

    const jobDir = `${this.jobsRoot}/${name}`;
    if (await this.fs.exists(jobDir)) {
      throw new HeirloomError(`Job '${name}' already exists`);
    }

    await this.fs.createDirectory(`${jobDir}/images`);
  }

  /**
   * List all jobs under the jobs root directory.
   * Derives status from filesystem contents and marks the active job.
   */
  async listJobs(): Promise<Job[]> {
    if (!(await this.fs.exists(this.jobsRoot))) {
      return [];
    }

    const entries = await this.fs.listDirectory(this.jobsRoot);
    const activeJob = await this.getActiveJob();

    const jobs: Job[] = [];

    for (const entry of entries) {
      // Skip hidden files like .active-job
      if (entry.startsWith('.')) continue;

      const jobDir = `${this.jobsRoot}/${entry}`;
      const status = await this.deriveStatus(jobDir);

      jobs.push({
        name: entry,
        status,
        isActive: entry === activeJob,
      });
    }

    return jobs;
  }

  /**
   * Get the currently active job name, or undefined if none is set.
   */
  async getActiveJob(): Promise<string | undefined> {
    const activeJobPath = `${this.jobsRoot}/.active-job`;
    if (!(await this.fs.exists(activeJobPath))) {
      return undefined;
    }
    const content = await this.fs.readFile(activeJobPath);
    return content.trim() || undefined;
  }

  /**
   * Set the active job. Throws if the job name is invalid or the job doesn't exist.
   */
  async setActiveJob(name: string): Promise<void> {
    this.validateJobName(name);

    const jobDir = `${this.jobsRoot}/${name}`;
    if (!(await this.fs.exists(jobDir))) {
      throw new HeirloomError(`Job '${name}' not found`);
    }

    await this.fs.writeFile(`${this.jobsRoot}/.active-job`, name);
  }

  /**
   * Derive the status of a job from its filesystem contents.
   * - `ingested` if manifest.csv exists
   * - `initialized` if images/ directory exists but no manifest.csv
   * - `empty` otherwise
   */
  private async deriveStatus(jobDir: string): Promise<Job['status']> {
    if (await this.fs.exists(`${jobDir}/manifest.csv`)) {
      return 'ingested';
    }
    if (await this.fs.exists(`${jobDir}/images`)) {
      return 'initialized';
    }
    return 'empty';
  }
}
