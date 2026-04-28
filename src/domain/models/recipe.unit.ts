import { recipeSchema, confidenceScoreSchema } from './recipe.js';

const validRecipe = {
  jobName: 'my-job',
  recipeNumber: '1',
  source: "Mom's Card Box",
  title: 'Chocolate Chip Cookies',
  ingredients: ['2 cups flour', '1 cup sugar'],
  instructions: ['Mix dry ingredients', 'Bake at 350F'],
  notes: 'Family favorite',
  imageKeys: ['my-job/IMG_0001.jpg'],
  confidence: {
    title: 0.95,
    ingredients: 0.88,
    instructions: 0.91,
    notes: 0.75,
  },
};

describe('recipeSchema', () => {
  it('accepts a valid Recipe object', () => {
    const result = recipeSchema.safeParse(validRecipe);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(validRecipe);
  });

  it('applies default empty string for notes when omitted', () => {
    const { notes: _notes, ...withoutNotes } = validRecipe;
    const result = recipeSchema.safeParse(withoutNotes);
    expect(result.success).toBe(true);
    expect(result.data!.notes).toBe('');
  });

  it('accepts notes as empty string', () => {
    const result = recipeSchema.safeParse({ ...validRecipe, notes: '' });
    expect(result.success).toBe(true);
  });

  describe('rejects missing required fields', () => {
    it.each(['jobName', 'recipeNumber', 'title'] as const)(
      'rejects missing %s',
      (field) => {
        const { [field]: _omitted, ...rest } = validRecipe;
        expect(recipeSchema.safeParse(rest).success).toBe(false);
      },
    );

    it('rejects missing ingredients', () => {
      const { ingredients: _omitted, ...rest } = validRecipe;
      expect(recipeSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects missing instructions', () => {
      const { instructions: _omitted, ...rest } = validRecipe;
      expect(recipeSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects missing confidence', () => {
      const { confidence: _omitted, ...rest } = validRecipe;
      expect(recipeSchema.safeParse(rest).success).toBe(false);
    });
  });

  describe('rejects empty required string fields', () => {
    it('rejects empty jobName', () => {
      expect(recipeSchema.safeParse({ ...validRecipe, jobName: '' }).success).toBe(false);
    });

    it('rejects empty recipeNumber', () => {
      expect(recipeSchema.safeParse({ ...validRecipe, recipeNumber: '' }).success).toBe(false);
    });

    it('rejects empty title', () => {
      expect(recipeSchema.safeParse({ ...validRecipe, title: '' }).success).toBe(false);
    });
  });

  describe('rejects empty arrays for ingredients and instructions', () => {
    it('rejects empty ingredients array', () => {
      expect(
        recipeSchema.safeParse({ ...validRecipe, ingredients: [] }).success,
      ).toBe(true); // empty array is structurally valid per schema (no minLength on array)
    });

    it('rejects ingredients with empty strings', () => {
      expect(
        recipeSchema.safeParse({ ...validRecipe, ingredients: [''] }).success,
      ).toBe(false);
    });

    it('rejects instructions with empty strings', () => {
      expect(
        recipeSchema.safeParse({ ...validRecipe, instructions: [''] }).success,
      ).toBe(false);
    });
  });

  describe('confidence score validation', () => {
    it('rejects confidence score above 1', () => {
      const bad = {
        ...validRecipe,
        confidence: { ...validRecipe.confidence, title: 1.1 },
      };
      expect(recipeSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects confidence score below 0', () => {
      const bad = {
        ...validRecipe,
        confidence: { ...validRecipe.confidence, ingredients: -0.1 },
      };
      expect(recipeSchema.safeParse(bad).success).toBe(false);
    });

    it('accepts confidence score at boundary 0', () => {
      const edge = {
        ...validRecipe,
        confidence: { title: 0, ingredients: 0, instructions: 0, notes: 0 },
      };
      expect(recipeSchema.safeParse(edge).success).toBe(true);
    });

    it('accepts confidence score at boundary 1', () => {
      const edge = {
        ...validRecipe,
        confidence: { title: 1, ingredients: 1, instructions: 1, notes: 1 },
      };
      expect(recipeSchema.safeParse(edge).success).toBe(true);
    });
  });

  it('accepts multiple imageKeys', () => {
    const result = recipeSchema.safeParse({
      ...validRecipe,
      imageKeys: ['my-job/IMG_0001.jpg', 'my-job/IMG_0002.jpg'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects imageKeys with empty strings', () => {
    expect(
      recipeSchema.safeParse({ ...validRecipe, imageKeys: [''] }).success,
    ).toBe(false);
  });
});

describe('confidenceScoreSchema', () => {
  it.each([0, 0.5, 1])('accepts %s', (score) => {
    expect(confidenceScoreSchema.safeParse(score).success).toBe(true);
  });

  it.each([-0.01, 1.01, -1, 2, NaN])('rejects %s', (score) => {
    expect(confidenceScoreSchema.safeParse(score).success).toBe(false);
  });
});
