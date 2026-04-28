import { ObsidianVaultAdapter } from './obsidian-vault-adapter.js';
import type { FileSystemPort } from '../../domain/ports/file-system-port.js';
import type { Recipe } from '../../domain/models/recipe.js';

/**
 * Creates a minimal Recipe object for testing.
 */
function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    jobName: 'test-job',
    recipeNumber: '001',
    source: 'Grandma',
    title: 'Chocolate Cake',
    ingredients: ['flour', 'sugar', 'cocoa'],
    instructions: ['Mix dry ingredients', 'Add wet ingredients', 'Bake at 350°F'],
    notes: 'Best served warm',
    imageKeys: ['test-job/img001.jpg'],
    confidence: { title: 0.95, ingredients: 0.9, instructions: 0.85, notes: 0.8 },
    ...overrides,
  };
}

/**
 * Creates a mock FileSystemPort that records all calls.
 */
function createMockFileSystem() {
  const writtenFiles: Map<string, string> = new Map();
  const createdDirs: string[] = [];

  const fileSystem: FileSystemPort = {
    async createDirectory(path: string): Promise<void> {
      createdDirs.push(path);
    },
    async exists(_path: string): Promise<boolean> {
      return false;
    },
    async getFileModifiedTime(_path: string): Promise<Date> {
      return new Date();
    },
    async listDirectory(_path: string): Promise<string[]> {
      return [];
    },
    async readFile(_path: string): Promise<string> {
      return '';
    },
    async writeFile(path: string, content: string): Promise<void> {
      writtenFiles.set(path, content);
    },
  };

  return { fileSystem, writtenFiles, createdDirs };
}

describe('ObsidianVaultAdapter', () => {
  it('creates the output directory', async () => {
    const { fileSystem, createdDirs } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    await adapter.renderVault([makeRecipe()], '/exports/test-job/vault');

    expect(createdDirs).toContain('/exports/test-job/vault');
  });

  it('writes one file per recipe with correct filename pattern', async () => {
    const { fileSystem, writtenFiles } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    const recipes = [
      makeRecipe({ recipeNumber: '001', title: 'Chocolate Cake' }),
      makeRecipe({ recipeNumber: '002', title: 'Apple Pie' }),
      makeRecipe({ recipeNumber: '003', title: 'Banana Bread' }),
    ];

    await adapter.renderVault(recipes, '/exports/test-job/vault');

    // 3 recipe files + 1 index file = 4 total
    expect(writtenFiles.size).toBe(4);

    // Verify filename pattern: <recipeNumber>-<slugified-title>.md
    const filenames = [...writtenFiles.keys()];
    expect(filenames).toContainEqual(expect.stringContaining('001-chocolate-cake.md'));
    expect(filenames).toContainEqual(expect.stringContaining('002-apple-pie.md'));
    expect(filenames).toContainEqual(expect.stringContaining('003-banana-bread.md'));
  });

  it('writes _index.md', async () => {
    const { fileSystem, writtenFiles } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    await adapter.renderVault([makeRecipe()], '/exports/test-job/vault');

    const indexPath = [...writtenFiles.keys()].find((p) => p.endsWith('_index.md'));
    expect(indexPath).toBeDefined();

    const indexContent = writtenFiles.get(indexPath!)!;
    expect(indexContent).toContain('Recipe Index');
    expect(indexContent).toContain('Chocolate Cake');
  });

  it('index contains wikilinks for all recipes', async () => {
    const { fileSystem, writtenFiles } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    const recipes = [
      makeRecipe({ recipeNumber: '001', title: 'Chocolate Cake' }),
      makeRecipe({ recipeNumber: '002', title: 'Apple Pie' }),
    ];

    await adapter.renderVault(recipes, '/exports/test-job/vault');

    const indexPath = [...writtenFiles.keys()].find((p) => p.endsWith('_index.md'));
    const indexContent = writtenFiles.get(indexPath!)!;

    expect(indexContent).toContain('[[001-chocolate-cake|Chocolate Cake]]');
    expect(indexContent).toContain('[[002-apple-pie|Apple Pie]]');
  });

  it('recipe files contain YAML frontmatter with recipeNumber', async () => {
    const { fileSystem, writtenFiles } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    await adapter.renderVault(
      [makeRecipe({ recipeNumber: '042', title: 'Test Recipe' })],
      '/exports/test-job/vault',
    );

    const recipePath = [...writtenFiles.keys()].find((p) => p.includes('042-test-recipe.md'));
    const content = writtenFiles.get(recipePath!)!;

    expect(content).toContain('recipeNumber: "042"');
    expect(content).toContain('jobName: "test-job"');
  });

  it('overwrites existing files on re-export (idempotent)', async () => {
    const { fileSystem, writtenFiles } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    const recipes = [makeRecipe({ recipeNumber: '001', title: 'Chocolate Cake' })];

    // First export
    await adapter.renderVault(recipes, '/exports/test-job/vault');
    const firstContent = writtenFiles.get(
      [...writtenFiles.keys()].find((p) => p.includes('001-chocolate-cake.md'))!,
    );

    // Second export — should overwrite without error
    await adapter.renderVault(recipes, '/exports/test-job/vault');
    const secondContent = writtenFiles.get(
      [...writtenFiles.keys()].find((p) => p.includes('001-chocolate-cake.md'))!,
    );

    // Content should be identical (idempotent)
    expect(firstContent).toBe(secondContent);
  });

  it('uses correct output directory path for all files', async () => {
    const { fileSystem, writtenFiles } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    await adapter.renderVault([makeRecipe()], '/my/custom/vault');

    const allPaths = [...writtenFiles.keys()];
    for (const filePath of allPaths) {
      // Normalize separators for cross-platform compatibility
      const normalized = filePath.replace(/\\/g, '/');
      expect(normalized).toMatch(/^\/my\/custom\/vault\//);
    }
  });

  it('handles a single recipe correctly', async () => {
    const { fileSystem, writtenFiles } = createMockFileSystem();
    const adapter = new ObsidianVaultAdapter(fileSystem);

    await adapter.renderVault([makeRecipe()], '/exports/test-job/vault');

    // 1 recipe file + 1 index file
    expect(writtenFiles.size).toBe(2);
  });
});
