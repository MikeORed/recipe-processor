import { PdfKitAdapter } from './pdfkit-adapter.js';
import type { Recipe } from '../../domain/models/recipe.js';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

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
 * Spy on PDFKit by intercepting the `text` calls made to the document.
 * We mock the pdfkit module to capture all text written to the PDF.
 */
let capturedTexts: string[] = [];
let addPageCount: number;

jest.mock('pdfkit', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      capturedTexts = [];
      addPageCount = 0;

      const mockDoc = {
        pipe: jest.fn().mockReturnThis(),
        fontSize: jest.fn().mockReturnThis(),
        fillColor: jest.fn().mockReturnThis(),
        moveDown: jest.fn().mockReturnThis(),
        addPage: jest.fn().mockImplementation(() => {
          addPageCount++;
          return mockDoc;
        }),
        text: jest.fn().mockImplementation((content: string) => {
          capturedTexts.push(content);
          return mockDoc;
        }),
        end: jest.fn().mockImplementation(() => {
          // Simulate the stream finishing
        }),
        on: jest.fn().mockReturnThis(),
      };
      return mockDoc;
    }),
  };
});

// Mock node:fs to avoid actual file writes
jest.mock('node:fs', () => ({
  createWriteStream: jest.fn().mockReturnValue({
    on: jest.fn().mockImplementation((event: string, cb: () => void) => {
      if (event === 'finish') {
        // Call finish immediately to resolve the promise
        setTimeout(cb, 0);
      }
      return { on: jest.fn() };
    }),
  }),
}));

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

describe('PdfKitAdapter', () => {
  let adapter: PdfKitAdapter;

  beforeEach(() => {
    adapter = new PdfKitAdapter();
    capturedTexts = [];
    addPageCount = 0;
  });

  it('creates the output directory via mkdir', async () => {
    const { mkdir } = await import('node:fs/promises');
    const recipes = [makeRecipe()];

    await adapter.render(recipes, '/some/path/output/cookbook.pdf');

    expect(mkdir).toHaveBeenCalledWith('/some/path/output', { recursive: true });
  });

  it('completes without error for valid recipes', async () => {
    const recipes = [makeRecipe()];

    await expect(adapter.render(recipes, '/tmp/test.pdf')).resolves.toBeUndefined();
  });

  it('adds a page for each recipe', async () => {
    const recipes = [
      makeRecipe({ recipeNumber: '001', title: 'Chocolate Cake' }),
      makeRecipe({ recipeNumber: '002', title: 'Apple Pie' }),
      makeRecipe({ recipeNumber: '003', title: 'Banana Bread' }),
    ];

    await adapter.render(recipes, '/tmp/test.pdf');

    expect(addPageCount).toBe(3);
  });

  describe('table of contents', () => {
    it('includes "Table of Contents" heading', async () => {
      const recipes = [makeRecipe()];

      await adapter.render(recipes, '/tmp/test.pdf');

      expect(capturedTexts).toContain('Table of Contents');
    });

    it('includes all recipe titles with recipe numbers', async () => {
      const recipes = [
        makeRecipe({ recipeNumber: '001', title: 'Chocolate Cake' }),
        makeRecipe({ recipeNumber: '002', title: 'Apple Pie' }),
      ];

      await adapter.render(recipes, '/tmp/test.pdf');

      expect(capturedTexts).toContain('001. Chocolate Cake');
      expect(capturedTexts).toContain('002. Apple Pie');
    });
  });

  describe('recipe sections', () => {
    it('includes recipe number and title in each section', async () => {
      const recipes = [makeRecipe({ recipeNumber: '042', title: 'Test Recipe' })];

      await adapter.render(recipes, '/tmp/test.pdf');

      expect(capturedTexts).toContain('042. Test Recipe');
    });

    it('includes source when present', async () => {
      const recipes = [makeRecipe({ source: 'Family Cookbook' })];

      await adapter.render(recipes, '/tmp/test.pdf');

      expect(capturedTexts).toContain('Source: Family Cookbook');
    });

    it('includes all ingredients', async () => {
      const recipes = [makeRecipe({ ingredients: ['butter', 'eggs', 'vanilla'] })];

      await adapter.render(recipes, '/tmp/test.pdf');

      expect(capturedTexts).toContain('  • butter');
      expect(capturedTexts).toContain('  • eggs');
      expect(capturedTexts).toContain('  • vanilla');
    });

    it('includes all instructions with numbering', async () => {
      const recipes = [makeRecipe({ instructions: ['Cream the butter', 'Add eggs'] })];

      await adapter.render(recipes, '/tmp/test.pdf');

      expect(capturedTexts).toContain('  1. Cream the butter');
      expect(capturedTexts).toContain('  2. Add eggs');
    });

    it('includes notes when present', async () => {
      const recipes = [makeRecipe({ notes: ['Refrigerate overnight'] })];

      await adapter.render(recipes, '/tmp/test.pdf');

      expect(capturedTexts).toContain('  • Refrigerate overnight');
    });

    it('includes image key references', async () => {
      const recipes = [makeRecipe({ imageKeys: ['test-job/photo1.jpg', 'test-job/photo2.jpg'] })];

      await adapter.render(recipes, '/tmp/test.pdf');

      const imageText = capturedTexts.find((t) => t.includes('test-job/photo1.jpg'));
      expect(imageText).toBeDefined();
      expect(imageText).toContain('test-job/photo2.jpg');
    });

    it('does not include source line when source is empty', async () => {
      const recipes = [makeRecipe({ source: '' })];

      await adapter.render(recipes, '/tmp/test.pdf');

      const sourceTexts = capturedTexts.filter((t) => t.startsWith('Source:'));
      expect(sourceTexts).toHaveLength(0);
    });

    it('does not include notes section when notes is empty', async () => {
      const recipes = [makeRecipe({ notes: [] })];

      await adapter.render(recipes, '/tmp/test.pdf');

      const notesHeaders = capturedTexts.filter((t) => t.startsWith('Notes'));
      expect(notesHeaders).toHaveLength(0);
    });
  });

  describe('review markers for low-confidence fields', () => {
    it('adds review marker for low-confidence title', async () => {
      const recipes = [
        makeRecipe({ confidence: { title: 0.5, ingredients: 0.9, instructions: 0.9, notes: 0.9 } }),
      ];

      await adapter.render(recipes, '/tmp/test.pdf');

      const titleText = capturedTexts.find((t) => t.includes('Chocolate Cake') && t.includes('⚠️'));
      expect(titleText).toBeDefined();
    });

    it('adds review marker for low-confidence ingredients', async () => {
      const recipes = [
        makeRecipe({ confidence: { title: 0.9, ingredients: 0.3, instructions: 0.9, notes: 0.9 } }),
      ];

      await adapter.render(recipes, '/tmp/test.pdf');

      const ingredientsHeader = capturedTexts.find(
        (t) => t.includes('Ingredients') && t.includes('⚠️'),
      );
      expect(ingredientsHeader).toBeDefined();
    });

    it('adds review marker for low-confidence instructions', async () => {
      const recipes = [
        makeRecipe({ confidence: { title: 0.9, ingredients: 0.9, instructions: 0.4, notes: 0.9 } }),
      ];

      await adapter.render(recipes, '/tmp/test.pdf');

      const instructionsHeader = capturedTexts.find(
        (t) => t.includes('Instructions') && t.includes('⚠️'),
      );
      expect(instructionsHeader).toBeDefined();
    });

    it('adds review marker for low-confidence notes', async () => {
      const recipes = [
        makeRecipe({ confidence: { title: 0.9, ingredients: 0.9, instructions: 0.9, notes: 0.1 } }),
      ];

      await adapter.render(recipes, '/tmp/test.pdf');

      const notesHeader = capturedTexts.find((t) => t.includes('Notes') && t.includes('⚠️'));
      expect(notesHeader).toBeDefined();
    });

    it('does not add review markers when all confidence scores are high', async () => {
      const recipes = [
        makeRecipe({ confidence: { title: 0.9, ingredients: 0.9, instructions: 0.9, notes: 0.9 } }),
      ];

      await adapter.render(recipes, '/tmp/test.pdf');

      const markedTexts = capturedTexts.filter((t) => t.includes('⚠️'));
      expect(markedTexts).toHaveLength(0);
    });
  });
});
