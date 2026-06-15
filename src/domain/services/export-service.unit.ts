import { ExportService, CANONICAL_CATEGORY_ORDER, groupRecipesByCategory } from './export-service.js';
import type { DataStore } from '../ports/data-store-port.js';
import type { PdfRendererPort, ChapterGroup, PdfRenderOptions } from '../ports/pdf-renderer-port.js';
import type { MarkdownRendererPort } from '../ports/markdown-renderer-port.js';
import type { Recipe } from '../models/recipe.js';
import type { JobStatus } from '../models/job.js';
import { HeirloomError } from '../../shared/errors.js';

/**
 * Creates a minimal Recipe object for testing.
 */
function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    jobName: 'test-job',
    recipeNumber: '001',
    source: 'Grandma',
    title: 'Chocolate Cake',
    author: 'Grandma',
    year: null,
    category: 'Cakes',
    cuisine: null,
    tags: ['dessert', 'cake'],
    ingredients: ['flour', 'sugar', 'cocoa'],
    instructions: ['Mix dry ingredients', 'Add wet ingredients', 'Bake at 350°F'],
    notes: ['Best served warm'],
    imageKeys: ['test-job/img001.jpg'],
    confidence: { title: 0.95, ingredients: 0.9, instructions: 0.85, notes: 0.8 },
    ...overrides,
  };
}

/**
 * Creates mock ports with call tracking.
 */
function createMocks(overrides: {
  jobStatus?: JobStatus | undefined;
  recipes?: Recipe[];
} = {}) {
  const jobStatus = 'jobStatus' in overrides ? overrides.jobStatus : ('transcribed' as JobStatus | undefined);
  const recipes = overrides.recipes ?? [makeRecipe()];

  const calls: { method: string; args: unknown[] }[] = [];

  const dataStore: DataStore = {
    async getJobStatus(jobName: string): Promise<JobStatus | undefined> {
      calls.push({ method: 'getJobStatus', args: [jobName] });
      return jobStatus;
    },
    async getRecipesByJob(jobName: string): Promise<Recipe[]> {
      calls.push({ method: 'getRecipesByJob', args: [jobName] });
      return recipes;
    },
    async putRecipe(_recipe: Recipe): Promise<void> {
      calls.push({ method: 'putRecipe', args: [_recipe] });
    },
    async updateJobStatus(jobName: string, status: JobStatus): Promise<void> {
      calls.push({ method: 'updateJobStatus', args: [jobName, status] });
    },
    async getRecipeWithOcr(_jobName: string, _recipeNumber: string) {
      calls.push({ method: 'getRecipeWithOcr', args: [_jobName, _recipeNumber] });
      return undefined;
    },
  };

  let pdfRenderArgs: { chapters: ChapterGroup[]; options: PdfRenderOptions; outputPath: string } | undefined;
  const pdfRenderer: PdfRendererPort = {
    async render(chapters: ChapterGroup[], options: PdfRenderOptions, outputPath: string): Promise<void> {
      calls.push({ method: 'pdfRenderer.render', args: [chapters, options, outputPath] });
      pdfRenderArgs = { chapters, options, outputPath };
    },
  };

  let mdRenderArgs: { recipes: Recipe[]; outputDir: string } | undefined;
  const markdownRenderer: MarkdownRendererPort = {
    async renderVault(recipes: Recipe[], outputDir: string): Promise<void> {
      calls.push({ method: 'markdownRenderer.renderVault', args: [recipes, outputDir] });
      mdRenderArgs = { recipes, outputDir };
    },
  };

  return {
    calls,
    dataStore,
    pdfRenderer,
    markdownRenderer,
    getPdfRenderArgs: () => pdfRenderArgs,
    getMdRenderArgs: () => mdRenderArgs,
  };
}

describe('ExportService', () => {
  describe('call ordering', () => {
    it('calls getJobStatus before getRecipesByJob', async () => {
      const mocks = createMocks();
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await service.export('test-job', 'pdf', './exports/test-job/test-job.pdf');

      const methodNames = mocks.calls.map((c) => c.method);
      const statusIndex = methodNames.indexOf('getJobStatus');
      const recipesIndex = methodNames.indexOf('getRecipesByJob');

      expect(statusIndex).toBeGreaterThanOrEqual(0);
      expect(recipesIndex).toBeGreaterThanOrEqual(0);
      expect(statusIndex).toBeLessThan(recipesIndex);
    });
  });

  describe('job not found', () => {
    it('throws HeirloomError when job does not exist', async () => {
      const mocks = createMocks({ jobStatus: undefined });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await expect(service.export('missing-job', 'pdf', './out.pdf')).rejects.toThrow(HeirloomError);
      await expect(service.export('missing-job', 'pdf', './out.pdf')).rejects.toThrow(
        "Job 'missing-job' not found",
      );
    });

    it('does not call getRecipesByJob when job is not found', async () => {
      const mocks = createMocks({ jobStatus: undefined });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await expect(service.export('missing-job', 'pdf', './out.pdf')).rejects.toThrow();

      const methodNames = mocks.calls.map((c) => c.method);
      expect(methodNames).not.toContain('getRecipesByJob');
    });
  });

  describe('job status warning', () => {
    it('includes a warning when job status is not transcribed', async () => {
      const mocks = createMocks({ jobStatus: 'ingested' });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      const result = await service.export('test-job', 'pdf', './out.pdf');

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('test-job');
      expect(result.warnings[0]).toContain('ingested');
    });

    it('returns no warnings when job status is transcribed', async () => {
      const mocks = createMocks({ jobStatus: 'transcribed' });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      const result = await service.export('test-job', 'pdf', './out.pdf');

      expect(result.warnings).toHaveLength(0);
    });

    it('still proceeds with export when status is not transcribed', async () => {
      const mocks = createMocks({ jobStatus: 'ingested' });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      const result = await service.export('test-job', 'pdf', './out.pdf');

      expect(result.recipeCount).toBe(1);
      const methodNames = mocks.calls.map((c) => c.method);
      expect(methodNames).toContain('pdfRenderer.render');
    });
  });

  describe('zero recipes', () => {
    it('throws HeirloomError when no recipes are found', async () => {
      const mocks = createMocks({ recipes: [] });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await expect(service.export('test-job', 'pdf', './out.pdf')).rejects.toThrow(HeirloomError);
      await expect(service.export('test-job', 'pdf', './out.pdf')).rejects.toThrow(
        "No recipes found for job 'test-job'",
      );
    });

    it('does not call any renderer when no recipes are found', async () => {
      const mocks = createMocks({ recipes: [] });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await expect(service.export('test-job', 'pdf', './out.pdf')).rejects.toThrow();

      const methodNames = mocks.calls.map((c) => c.method);
      expect(methodNames).not.toContain('pdfRenderer.render');
      expect(methodNames).not.toContain('markdownRenderer.renderVault');
    });
  });

  describe('recipe sorting', () => {
    it('groups recipes by category and sorts alphabetically by title within chapters', async () => {
      const recipes = [
        makeRecipe({ recipeNumber: '003', title: 'Zucchini Bread', category: 'Breads' }),
        makeRecipe({ recipeNumber: '001', title: 'Apple Pie', category: 'Pies & Pastries' }),
        makeRecipe({ recipeNumber: '002', title: 'Banana Bread', category: 'Breads' }),
      ];
      const mocks = createMocks({ recipes });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await service.export('test-job', 'pdf', './out.pdf');

      const chapters = mocks.getPdfRenderArgs()!.chapters;
      expect(chapters).toHaveLength(2);
      expect(chapters[0].chapter).toBe('Breads');
      expect(chapters[0].recipes.map((r) => r.title)).toEqual(['Banana Bread', 'Zucchini Bread']);
      expect(chapters[1].chapter).toBe('Pies & Pastries');
      expect(chapters[1].recipes.map((r) => r.title)).toEqual(['Apple Pie']);
    });

    it('sorts obsidian format by recipeNumber ascending (lexicographic)', async () => {
      const recipes = [
        makeRecipe({ recipeNumber: '10' }),
        makeRecipe({ recipeNumber: '2' }),
        makeRecipe({ recipeNumber: '1' }),
      ];
      const mocks = createMocks({ recipes });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await service.export('test-job', 'obsidian', './out/');

      const renderedRecipes = mocks.getMdRenderArgs()!.recipes;
      // Lexicographic: "1" < "10" < "2"
      expect(renderedRecipes.map((r) => r.recipeNumber)).toEqual(['1', '10', '2']);
    });
  });

  describe('format delegation', () => {
    it('delegates to pdfRenderer when format is pdf', async () => {
      const mocks = createMocks();
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await service.export('test-job', 'pdf', './exports/test-job/test-job.pdf');

      const methodNames = mocks.calls.map((c) => c.method);
      expect(methodNames).toContain('pdfRenderer.render');
      expect(methodNames).not.toContain('markdownRenderer.renderVault');

      const args = mocks.getPdfRenderArgs()!;
      expect(args.outputPath).toBe('./exports/test-job/test-job.pdf');
    });

    it('delegates to markdownRenderer when format is obsidian', async () => {
      const mocks = createMocks();
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await service.export('test-job', 'obsidian', './exports/test-job/vault/');

      const methodNames = mocks.calls.map((c) => c.method);
      expect(methodNames).toContain('markdownRenderer.renderVault');
      expect(methodNames).not.toContain('pdfRenderer.render');

      const args = mocks.getMdRenderArgs()!;
      expect(args.outputDir).toBe('./exports/test-job/vault/');
    });
  });

  describe('ExportResult', () => {
    it('returns correct recipe count and output path', async () => {
      const recipes = [
        makeRecipe({ recipeNumber: '001' }),
        makeRecipe({ recipeNumber: '002' }),
        makeRecipe({ recipeNumber: '003' }),
      ];
      const mocks = createMocks({ recipes });
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      const result = await service.export('test-job', 'pdf', './exports/test-job/test-job.pdf');

      expect(result.recipeCount).toBe(3);
      expect(result.outputPath).toBe('./exports/test-job/test-job.pdf');
      expect(result.warnings).toEqual([]);
    });
  });

  describe('renderer errors', () => {
    it('propagates errors from the pdf renderer without catching them', async () => {
      const mocks = createMocks();
      const rendererError = new HeirloomError('PDF generation failed');
      mocks.pdfRenderer.render = async () => {
        throw rendererError;
      };
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await expect(service.export('test-job', 'pdf', './out.pdf')).rejects.toThrow(rendererError);
    });

    it('propagates errors from the markdown renderer without catching them', async () => {
      const mocks = createMocks();
      const rendererError = new HeirloomError('Vault write failed');
      mocks.markdownRenderer.renderVault = async () => {
        throw rendererError;
      };
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await expect(service.export('test-job', 'obsidian', './out/')).rejects.toThrow(rendererError);
    });

    it('does not perform any cleanup after a renderer error', async () => {
      const mocks = createMocks();
      mocks.pdfRenderer.render = async () => {
        throw new HeirloomError('PDF generation failed');
      };
      const service = new ExportService(mocks.dataStore, mocks.pdfRenderer, mocks.markdownRenderer);

      await expect(service.export('test-job', 'pdf', './out.pdf')).rejects.toThrow();

      // Only dataStore calls + the failed render — no cleanup calls
      const methodNames = mocks.calls.map((c) => c.method);
      expect(methodNames).toEqual(['getJobStatus', 'getRecipesByJob']);
    });
  });
});
