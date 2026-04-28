import type { Recipe } from '../models/index.js';

export interface PdfRendererPort {
  render(recipes: Recipe[], outputPath: string): Promise<void>;
}
