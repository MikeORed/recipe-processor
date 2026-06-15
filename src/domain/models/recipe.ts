import { z } from 'zod/v4';

// --- Confidence Score ---

export const confidenceScoreSchema = z.number().min(0).max(1);

// --- Category & Cuisine Enums ---

export const categoryEnum = z.enum([
  'Appetizers & Snacks',
  'Soups & Stews',
  'Salads & Dressings',
  'Beef & Pork',
  'Poultry',
  'Seafood',
  'Pasta & Rice',
  'Sides & Vegetables',
  'Breads',
  'Cakes',
  'Pies & Pastries',
  'Cookies & Bars',
  'Beverages',
  'Sauces & Condiments',
  'uncategorized',
]);

export const cuisineEnum = z.enum([
  'American',
  'American Regional',
  'Mexican & Central American',
  'South American',
  'Caribbean',
  'Italian',
  'French',
  'European & Eastern European',
  'Mediterranean',
  'Middle Eastern',
  'African',
  'South Asian',
  'East Asian',
  'Southeast Asian',
  'Other',
]);

// --- Recipe ---

export const recipeSchema = z.object({
  jobName: z.string().min(1),
  recipeNumber: z.string().min(1),
  source: z.string(),
  title: z.string().min(1),
  author: z.string().nullable().default(null),
  year: z.number().int().nullable().default(null),
  category: categoryEnum,
  cuisine: cuisineEnum.nullable().default(null),
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
