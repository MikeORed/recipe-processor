import type { Recipe } from '../models/index.js';

/**
 * Convert a title string into a filename-safe slug.
 *
 * - Lowercase the input
 * - Replace non-alphanumeric characters with hyphens
 * - Collapse consecutive hyphens into a single hyphen
 * - Strip leading/trailing hyphens
 * - Truncate to 100 characters
 * - If the result is empty, return 'untitled'
 */
export function slugify(title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > 100) {
    slug = slug.slice(0, 100).replace(/-+$/, '');
  }

  return slug || 'untitled';
}

/**
 * Build the vault filename for a recipe.
 *
 * Returns `<recipeNumber>-<slugified-title>.md`.
 */
export function buildVaultFilename(recipeNumber: string, title: string): string {
  return `${recipeNumber}-${slugify(title)}.md`;
}

/**
 * Render a single Recipe as a complete Markdown string with YAML frontmatter.
 *
 * Frontmatter includes recipeNumber, jobName, imageKeys, and a conditional
 * `needs-review` tag when any confidence score is below 0.7.
 *
 * Body includes the title as a level-1 heading, optional source wikilink,
 * ingredients list, instructions list, and notes section. Fields with
 * confidence < 0.7 receive an inline comment annotation.
 */
export function renderRecipeMarkdown(recipe: Recipe): string {
  const hasLowConfidence =
    recipe.confidence.title < 0.7 ||
    recipe.confidence.ingredients < 0.7 ||
    recipe.confidence.instructions < 0.7 ||
    recipe.confidence.notes < 0.7;

  // --- YAML frontmatter ---
  const frontmatterLines: string[] = ['---'];
  frontmatterLines.push(`recipeNumber: "${recipe.recipeNumber}"`);
  frontmatterLines.push(`jobName: "${recipe.jobName}"`);

  frontmatterLines.push('imageKeys:');
  for (const key of recipe.imageKeys) {
    frontmatterLines.push(`  - "${key}"`);
  }

  if (hasLowConfidence) {
    frontmatterLines.push('tags:');
    frontmatterLines.push('  - needs-review');
  }

  frontmatterLines.push('---');

  // --- Body ---
  const bodyLines: string[] = [];

  // Title
  if (recipe.confidence.title < 0.7) {
    bodyLines.push(`# ${recipe.title} <!-- low-confidence: title -->`);
  } else {
    bodyLines.push(`# ${recipe.title}`);
  }

  bodyLines.push('');

  // Source wikilink
  if (recipe.source) {
    bodyLines.push(`[[source:${recipe.source}]]`);
    bodyLines.push('');
  }

  // Ingredients
  bodyLines.push('## Ingredients');
  bodyLines.push('');
  if (recipe.confidence.ingredients < 0.7) {
    bodyLines.push('<!-- low-confidence: ingredients -->');
  }
  for (const ingredient of recipe.ingredients) {
    bodyLines.push(`- ${ingredient}`);
  }
  bodyLines.push('');

  // Instructions
  bodyLines.push('## Instructions');
  bodyLines.push('');
  if (recipe.confidence.instructions < 0.7) {
    bodyLines.push('<!-- low-confidence: instructions -->');
  }
  for (let i = 0; i < recipe.instructions.length; i++) {
    bodyLines.push(`${i + 1}. ${recipe.instructions[i]}`);
  }
  bodyLines.push('');

  // Notes
  bodyLines.push('## Notes');
  bodyLines.push('');
  if (recipe.confidence.notes < 0.7) {
    bodyLines.push('<!-- low-confidence: notes -->');
  }
  bodyLines.push(recipe.notes);
  bodyLines.push('');

  return frontmatterLines.join('\n') + '\n\n' + bodyLines.join('\n');
}

/**
 * Render an index Markdown file listing all recipes with wikilinks.
 *
 * Each recipe gets a wikilink entry using `buildVaultFilename` for the target.
 */
export function renderIndexMarkdown(recipes: Recipe[]): string {
  const lines: string[] = [];

  lines.push('# Recipe Index');
  lines.push('');

  for (const recipe of recipes) {
    const filename = buildVaultFilename(recipe.recipeNumber, recipe.title);
    // Remove .md extension for wikilink target
    const linkTarget = filename.replace(/\.md$/, '');
    lines.push(`- [[${linkTarget}|${recipe.title}]]`);
  }

  lines.push('');

  return lines.join('\n');
}
