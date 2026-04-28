import { serializeManifest, parseManifest, MANIFEST_COLUMNS } from './csv-utils.js';
import type { ManifestEntry } from '../models/index.js';

describe('MANIFEST_COLUMNS', () => {
  it('has the correct header columns in order', () => {
    expect(MANIFEST_COLUMNS).toEqual(['file', 'modified', 'recipe_number', 'source']);
  });
});

describe('serializeManifest', () => {
  it('produces header-only output for empty entries', () => {
    const csv = serializeManifest([]);
    expect(csv).toBe('file,modified,recipe_number,source\n');
  });

  it('serializes a single entry with plain fields', () => {
    const entries: ManifestEntry[] = [
      { file: 'IMG_0001.jpg', modified: '2026-04-25T10:01:00.000Z', recipeNumber: '1', source: 'Grandma' },
    ];
    const csv = serializeManifest(entries);
    expect(csv).toBe(
      'file,modified,recipe_number,source\n' +
      'IMG_0001.jpg,2026-04-25T10:01:00.000Z,1,Grandma\n',
    );
  });

  it('quotes fields containing commas', () => {
    const entries: ManifestEntry[] = [
      { file: 'photo.jpg', modified: '2026-01-01T00:00:00.000Z', recipeNumber: '', source: 'Mom, Dad' },
    ];
    const csv = serializeManifest(entries);
    expect(csv).toContain('"Mom, Dad"');
  });

  it('quotes and escapes fields containing double quotes', () => {
    const entries: ManifestEntry[] = [
      { file: 'photo.jpg', modified: '2026-01-01T00:00:00.000Z', recipeNumber: '', source: 'The "Best" Recipes' },
    ];
    const csv = serializeManifest(entries);
    expect(csv).toContain('"The ""Best"" Recipes"');
  });

  it('quotes fields containing newlines', () => {
    const entries: ManifestEntry[] = [
      { file: 'photo.jpg', modified: '2026-01-01T00:00:00.000Z', recipeNumber: '', source: 'Line1\nLine2' },
    ];
    const csv = serializeManifest(entries);
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('uses LF line endings', () => {
    const entries: ManifestEntry[] = [
      { file: 'a.jpg', modified: '2026-01-01T00:00:00.000Z', recipeNumber: '', source: '' },
    ];
    const csv = serializeManifest(entries);
    expect(csv).not.toContain('\r');
    // Every line break should be \n
    const lines = csv.split('\n');
    // Header + 1 data row + trailing empty string from final \n
    expect(lines.length).toBe(3);
    expect(lines[2]).toBe('');
  });
});

describe('parseManifest', () => {
  it('parses header-only CSV into empty array', () => {
    const csv = 'file,modified,recipe_number,source\n';
    expect(parseManifest(csv)).toEqual([]);
  });

  it('parses a single row', () => {
    const csv =
      'file,modified,recipe_number,source\n' +
      'IMG_0001.jpg,2026-04-25T10:01:00.000Z,1,Grandma\n';
    const entries = parseManifest(csv);
    expect(entries).toEqual([
      { file: 'IMG_0001.jpg', modified: '2026-04-25T10:01:00.000Z', recipeNumber: '1', source: 'Grandma' },
    ]);
  });

  it('handles quoted fields with commas', () => {
    const csv =
      'file,modified,recipe_number,source\n' +
      'photo.jpg,2026-01-01T00:00:00.000Z,,"Mom, Dad"\n';
    const entries = parseManifest(csv);
    expect(entries[0].source).toBe('Mom, Dad');
  });

  it('handles quoted fields with escaped double quotes', () => {
    const csv =
      'file,modified,recipe_number,source\n' +
      'photo.jpg,2026-01-01T00:00:00.000Z,,"The ""Best"" Recipes"\n';
    const entries = parseManifest(csv);
    expect(entries[0].source).toBe('The "Best" Recipes');
  });

  it('handles quoted fields with newlines', () => {
    const csv =
      'file,modified,recipe_number,source\n' +
      'photo.jpg,2026-01-01T00:00:00.000Z,,"Line1\nLine2"\n';
    const entries = parseManifest(csv);
    expect(entries[0].source).toBe('Line1\nLine2');
  });
});

describe('serializeManifest / parseManifest round-trip', () => {
  it('round-trips typical manifest data', () => {
    const entries: ManifestEntry[] = [
      { file: 'IMG_0001.jpg', modified: '2026-04-25T10:01:00.000Z', recipeNumber: '1', source: "Mom's Card Box" },
      { file: 'scan_002.png', modified: '2026-05-10T14:30:00.000Z', recipeNumber: '2', source: 'Church Cookbook' },
      { file: 'recipe-back.tiff', modified: '2026-06-01T08:00:00.000Z', recipeNumber: '', source: '' },
    ];
    const csv = serializeManifest(entries);
    const parsed = parseManifest(csv);
    expect(parsed).toEqual(entries);
  });

  it('round-trips entries with special characters in source', () => {
    const entries: ManifestEntry[] = [
      { file: 'photo.jpg', modified: '2026-01-01T00:00:00.000Z', recipeNumber: '3', source: 'Aunt "Betty", Sr.' },
      { file: 'card.bmp', modified: '2026-02-15T12:00:00.000Z', recipeNumber: '', source: 'Notes:\nPage 1\nPage 2' },
    ];
    const csv = serializeManifest(entries);
    const parsed = parseManifest(csv);
    expect(parsed).toEqual(entries);
  });
});
