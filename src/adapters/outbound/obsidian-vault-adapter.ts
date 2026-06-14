import { join } from 'node:path';

import type { MarkdownRendererPort } from '../../domain/ports/markdown-renderer-port.js';
import type { FileSystemPort } from '../../domain/ports/file-system-port.js';
import type { Recipe } from '../../domain/models/recipe.js';
import {
  renderRecipeMarkdown,
  renderIndexMarkdown,
  buildVaultFilenames,
} from '../../domain/services/markdown-utils.js';

/**
 * Outbound adapter that implements MarkdownRendererPort by writing an
 * Obsidian-compatible vault of interlinked Markdown files.
 *
 * Uses pure rendering functions from markdown-utils and delegates all
 * file system operations to the injected FileSystemPort.
 *
 * Re-exports are idempotent — existing files are overwritten.
 */
export class ObsidianVaultAdapter implements MarkdownRendererPort {
  constructor(private readonly fileSystem: FileSystemPort) {}

  async renderVault(recipes: Recipe[], outputDir: string): Promise<void> {
    // Ensure the output directory exists
    await this.fileSystem.createDirectory(outputDir);

    // Build deduplicated filename map
    const filenames = buildVaultFilenames(recipes);

    // Write one Markdown file per recipe
    for (const recipe of recipes) {
      const filename = filenames.get(recipe.recipeNumber) ?? `${recipe.recipeNumber}.md`;
      const filePath = join(outputDir, filename);
      const content = renderRecipeMarkdown(recipe);
      await this.fileSystem.writeFile(filePath, content);
    }

    // Write the index file
    const indexPath = join(outputDir, '_index.md');
    const indexContent = renderIndexMarkdown(recipes);
    await this.fileSystem.writeFile(indexPath, indexContent);
  }
}
