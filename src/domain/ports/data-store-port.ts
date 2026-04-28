import type { Recipe, JobStatus } from '../models/index.js';

export interface DataStore {
  putRecipe(recipe: Recipe): Promise<void>;
  getRecipesByJob(jobName: string): Promise<Recipe[]>;
  updateJobStatus(jobName: string, status: JobStatus): Promise<void>;
  getJobStatus(jobName: string): Promise<JobStatus | undefined>;
}
