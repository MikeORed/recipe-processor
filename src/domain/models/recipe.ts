import { z } from 'zod/v4';

// --- Confidence Score ---

export const confidenceScoreSchema = z.number().min(0).max(1);

// --- Recipe ---

export const recipeSchema = z.object({
  jobName: z.string().min(1),
  recipeNumber: z.string().min(1),
  source: z.string(),
  title: z.string().min(1),
  author: z.string().nullable().default(null),
  year: z.number().int().nullable().default(null),
  tags: z.array(z.string().min(1)).default([]),
  ingredients: z.array(z.string().min(1)),
  instructions: z.array(z.string().min(1)),
  notes: z.array(z.string()).default([]),
  imageKeys: z.array(z.string().min(1)),
  confidence: z.object({
    title: confidenceScoreSchema,
    ingredients: confidenceScoreSchema,
    instructions: confidenceScoreSchema,
    notes: confidenceScoreSchema,
  }),
});

export type Recipe = z.infer<typeof recipeSchema>;
