import { z } from 'zod/v4';

// --- Job Name ---

export const jobNameSchema = z
  .string()
  .min(1, 'Job name must not be empty')
  .max(128, 'Job name must not exceed 128 characters')
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    'Job name must be lowercase alphanumeric, hyphens, underscores, and start with a letter or digit',
  );

export type JobName = z.infer<typeof jobNameSchema>;

// --- Job Status ---

export const jobStatusSchema = z.enum(['empty', 'initialized', 'ingested']);

export type JobStatus = z.infer<typeof jobStatusSchema>;

// --- Job ---

export const jobSchema = z.object({
  name: jobNameSchema,
  status: jobStatusSchema,
  isActive: z.boolean(),
});

export type Job = z.infer<typeof jobSchema>;

// --- Manifest Entry ---

export const manifestEntrySchema = z.object({
  file: z.string().min(1),
  modified: z.string().min(1),
  recipeNumber: z.string().default(''),
  source: z.string().default(''),
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

// --- Supported Image Extensions ---

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
  '.tif',
  '.bmp',
  '.webp',
]);
