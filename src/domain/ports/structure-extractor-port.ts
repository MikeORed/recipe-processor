import type { Recipe } from '../models/index.js';

export interface ExtractionInput {
  ocrText: string;
  recipeNumber: string;
  source: string;
  jobName: string;
  imageKeys: string[];
}

export interface StructureExtractor {
  extract(input: ExtractionInput): Promise<Recipe>;
}
