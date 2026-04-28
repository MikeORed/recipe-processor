import type { Recipe } from '../models/index.js';

export interface MarkdownRendererPort {
  renderVault(recipes: Recipe[], outputDir: string): Promise<void>;
}
