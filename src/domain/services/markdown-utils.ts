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
 * Uses the recipe title as the primary identifier. If duplicates exist
 * in a set, callers should disambiguate before calling this function.
 */
export function buildVaultFilename(recipeNumber: string, title: string): string {
  return `${slugify(title)}.md`;
}

/**
 * Deduplicate filenames by appending a numeric suffix when titles collide.
 * Returns a Map from recipeNumber → filename.
 */
export function buildVaultFilenames(recipes: Recipe[]): Map<string, string> {
  const counts = new Map<string, number>();
  const result = new Map<string, string>();

  for (const recipe of recipes) {
    const baseSlug = slugify(recipe.title);
    const count = counts.get(baseSlug) ?? 0;
    counts.set(baseSlug, count + 1);

    const filename = count === 0
      ? `${baseSlug}.md`
      : `${baseSlug}-${count + 1}.md`;
    result.set(recipe.recipeNumber, filename);
  }

  return result;
}

/**
 * Render a single Recipe as a complete Markdown string with YAML frontmatter.
 *
 * Frontmatter includes recipeNumber, jobName, source, author, year, tags,
 * imageKeys, and a conditional `needs-review` tag when any confidence score
 * is below 0.7.
 *
 * Body includes the title as a level-1 heading, metadata section,
 * ingredients list, instructions list, and notes section.
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
  frontmatterLines.push(`source: "${recipe.source}"`);

  if (recipe.author) {
    frontmatterLines.push(`author: "${recipe.author}"`);
  }
  if (recipe.year) {
    frontmatterLines.push(`year: ${recipe.year}`);
  }

  if (recipe.tags.length > 0 || hasLowConfidence) {
    frontmatterLines.push('tags:');
    for (const tag of recipe.tags) {
      frontmatterLines.push(`  - ${tag}`);
    }
    if (hasLowConfidence) {
      frontmatterLines.push('  - needs-review');
    }
  }

  frontmatterLines.push('imageKeys:');
  for (const key of recipe.imageKeys) {
    frontmatterLines.push(`  - "${key}"`);
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

  // Metadata line
  const metaParts: string[] = [];
  if (recipe.source) {
    metaParts.push(`[[source:${recipe.source}]]`);
  }
  if (recipe.author) {
    metaParts.push(`[[author:${recipe.author}]]`);
  }
  if (recipe.year) {
    metaParts.push(`(${recipe.year})`);
  }
  if (metaParts.length > 0) {
    bodyLines.push(metaParts.join(' · '));
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
  if (recipe.notes.length > 0) {
    bodyLines.push('## Notes');
    bodyLines.push('');
    if (recipe.confidence.notes < 0.7) {
      bodyLines.push('<!-- low-confidence: notes -->');
    }
    for (const note of recipe.notes) {
      bodyLines.push(`- ${note}`);
    }
    bodyLines.push('');
  }

  return frontmatterLines.join('\n') + '\n\n' + bodyLines.join('\n');
}

/**
 * Render an index Markdown file listing all recipes with wikilinks,
 * grouped by tag category.
 */
export function renderIndexMarkdown(recipes: Recipe[]): string {
  const lines: string[] = [];

  lines.push('# Recipe Index');
  lines.push('');

  // Build filename map for deduplication
  const filenames = buildVaultFilenames(recipes);

  // Sort recipes by title for alphabetical listing
  const sorted = [...recipes].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  for (const recipe of sorted) {
    const filename = filenames.get(recipe.recipeNumber) ?? buildVaultFilename(recipe.recipeNumber, recipe.title);
    const linkTarget = filename.replace(/\.md$/, '');
    const authorSuffix = recipe.author ? ` — ${recipe.author}` : '';
    lines.push(`- [[${linkTarget}|${recipe.title}]]${authorSuffix}`);
  }

  lines.push('');

  return lines.join('\n');
}
