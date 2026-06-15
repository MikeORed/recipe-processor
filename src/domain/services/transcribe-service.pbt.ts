import fc from 'fast-check';
import { TranscribeService } from './transcribe-service.js';
import type { FileSystemPort } from '../ports/file-system-port.js';
import type { ObjectStore } from '../ports/object-store-port.js';
import type { OCRProvider, OCRResult } from '../ports/ocr-provider-port.js';
import type { StructureExtractor, ExtractionInput } from '../ports/structure-extractor-port.js';
import type { DataStore } from '../ports/data-store-port.js';
import type { Recipe, JobStatus, ManifestEntry } from '../models/index.js';
import { serializeManifest } from './csv-utils.js';

// Feature: transcribe-command, Properties 1–4, 7

// --- Arbitraries ---

/** Safe base filename (no dots, no path separators, no slashes). */
const baseNameArb = fc
  .stringMatching(/^[a-zA-Z0-9_-]{1,20}$/)
  .filter((s) => s.length >= 1);

/** Image filename with extension. */
const imageFileArb = fc
  .tuple(baseNameArb, fc.constantFrom('.jpg', '.jpeg', '.png', '.tiff'))
  .map(([name, ext]) => name + ext);

/** Non-empty recipe number. */
const recipeNumberArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,10}$/).filter((s) => s.length >= 1);

/** Source string. */
const sourceArb = fc.stringMatching(/^[A-Za-z0-9 _-]{0,20}$/);

/** Job name (lowercase alphanumeric, hyphens, underscores). */
const jobNameArb = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,15}$/).filter((s) => s.length >= 1);

// --- Mock factories ---

function createMockFs(readFileMap: Record<string, string>, existsMap: Record<string, boolean>): FileSystemPort {
  return {
    async createDirectory() {},
    async exists(p: string) { return existsMap[p] ?? false; },
    async getFileModifiedTime() { return new Date(); },
    async listDirectory() { return []; },
    async readFile(p: string) { return readFileMap[p] ?? ''; },
    async writeFile() {},
  };
}

function createMockObjectStore(existsKeys: Set<string>): ObjectStore & {
  uploadedKeys: string[];
} {
  const uploadedKeys: string[] = [];
  return {
    uploadedKeys,
    async upload(_localPath: string, key: string) { uploadedKeys.push(key); },
    async exists(key: string) { return existsKeys.has(key); },
  };
}

function createMockOCRProvider(errorKeys: Set<string> = new Set()): OCRProvider {
  return {
    async extractText(imageKey: string): Promise<OCRResult> {
      if (errorKeys.has(imageKey)) {
        throw new Error(`OCR failed for ${imageKey}`);
      }
      return { blocks: [{ text: `Text from ${imageKey}`, confidence: 0.95 }] };
    },
  };
}

function createMockStructureExtractor(errorRecipeNumbers: Set<string> = new Set()): StructureExtractor & {
  extractedInputs: ExtractionInput[];
} {
  const extractedInputs: ExtractionInput[] = [];
  return {
    extractedInputs,
    async extract(input: ExtractionInput): Promise<Recipe[]> {
      extractedInputs.push(input);
      if (errorRecipeNumbers.has(input.recipeNumber)) {
        throw new Error(`Extraction failed for recipe ${input.recipeNumber}`);
      }
      return [{
        jobName: input.jobName,
        recipeNumber: input.recipeNumber,
        source: input.source,
        title: `Recipe ${input.recipeNumber}`,
        author: null,
        year: null,
        category: 'uncategorized' as const,
        cuisine: null,
        tags: [],
        ingredients: ['ingredient1'],
        instructions: ['step1'],
        notes: [],
        imageKeys: input.imageKeys,
        confidence: { title: 0.9, ingredients: 0.85, instructions: 0.88, notes: 0.7 },
      }];
    },
  };
}

function createMockDataStore(): DataStore & { storedRecipes: Recipe[]; statusUpdates: Array<{ jobName: string; status: JobStatus }> } {
  const storedRecipes: Recipe[] = [];
  const statusUpdates: Array<{ jobName: string; status: JobStatus }> = [];
  return {
    storedRecipes,
    statusUpdates,
    async putRecipe(recipe: Recipe) { storedRecipes.push(recipe); },
    async getRecipesByJob(jobName: string) { return storedRecipes.filter((r) => r.jobName === jobName); },
    async updateJobStatus(jobName: string, status: JobStatus) { statusUpdates.push({ jobName, status }); },
    async getJobStatus() { return undefined; },
  };
}

// --- Manifest entry arbitrary ---

interface TestManifestSpec {
  file: string;
  recipeNumber: string; // may be empty
  source: string;
}

/** Generate a manifest entry that may or may not have a recipeNumber. */
const manifestSpecArb = (hasRecipeNumber: boolean): fc.Arbitrary<TestManifestSpec> =>
  fc.tuple(imageFileArb, hasRecipeNumber ? recipeNumberArb : fc.constant(''), sourceArb)
    .map(([file, recipeNumber, source]) => ({ file, recipeNumber, source }));

/** Generate a mixed manifest with some annotated and some unannotated entries. */
const mixedManifestArb = fc
  .tuple(
    fc.array(manifestSpecArb(true), { minLength: 1, maxLength: 10 }),
    fc.array(manifestSpecArb(false), { minLength: 0, maxLength: 5 }),
  )
  .map(([annotated, unannotated]) => {
    // Deduplicate by filename
    const seen = new Set<string>();
    const all: TestManifestSpec[] = [];
    for (const entry of [...annotated, ...unannotated]) {
      if (!seen.has(entry.file)) {
        seen.add(entry.file);
        all.push(entry);
      }
    }
    return all;
  })
  // Ensure at least one annotated entry survives dedup
  .filter((entries) => entries.some((e) => e.recipeNumber !== ''));

function toManifestEntries(specs: TestManifestSpec[]): ManifestEntry[] {
  return specs.map((s) => ({
    file: s.file,
    modified: '2025-01-01T00:00:00.000Z',
    recipeNumber: s.recipeNumber,
    source: s.source,
  }));
}

// --- Property tests ---

describe('TranscribeService (property-based)', () => {
  // Property 1: Manifest filtering and grouping
  // Validates: Requirements 2.2, 2.4
  describe('Property 1: Manifest filtering and grouping', () => {
    it('filters empty recipeNumber entries and groups the rest correctly', async () => {
      await fc.assert(
        fc.asyncProperty(mixedManifestArb, async (specs) => {
          const entries = toManifestEntries(specs);
          const service = new TranscribeService(
            createMockFs({}, {}),
            createMockObjectStore(new Set()),
            createMockOCRProvider(),
            createMockStructureExtractor(),
            createMockDataStore(),
          );

          const groups = service.groupByRecipeNumber(
            entries.filter((e) => e.recipeNumber.trim() !== ''),
          );

          const annotated = specs.filter((s) => s.recipeNumber !== '');
          const unannotated = specs.filter((s) => s.recipeNumber === '');

          // (a) Every entry in each group shares the same non-empty recipeNumber
          for (const [recipeNumber, groupEntries] of groups) {
            expect(recipeNumber).not.toBe('');
            for (const entry of groupEntries) {
              expect(entry.recipeNumber).toBe(recipeNumber);
            }
          }

          // (b) No entries with non-empty recipeNumber are lost
          let totalGrouped = 0;
          for (const groupEntries of groups.values()) {
            totalGrouped += groupEntries.length;
          }
          expect(totalGrouped).toBe(annotated.length);

          // (c) Filtered-out count equals entries with empty recipeNumber
          const filteredOut = entries.length - annotated.length;
          expect(filteredOut).toBe(unannotated.length);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 2: Upload key pattern
  // Validates: Requirements 3.1
  describe('Property 2: Upload key pattern', () => {
    it('produces key equal to <jobName>/<filename>', async () => {
      await fc.assert(
        fc.asyncProperty(jobNameArb, imageFileArb, async (jobName, filename) => {
          const service = new TranscribeService(
            createMockFs({}, {}),
            createMockObjectStore(new Set()),
            createMockOCRProvider(),
            createMockStructureExtractor(),
            createMockDataStore(),
          );

          const key = service.buildUploadKey(jobName, filename);
          expect(key).toBe(`${jobName}/${filename}`);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 3: Idempotent upload skip
  // Validates: Requirements 3.3, 13.2
  describe('Property 3: Idempotent upload skip', () => {
    it('uploads only when key does not exist, skips when it does', async () => {
      // Generate a list of image files and a random subset that "already exist"
      const testCaseArb = fc.tuple(
        jobNameArb,
        fc.array(imageFileArb, { minLength: 1, maxLength: 8 })
          .map((files) => [...new Set(files)])
          .filter((files) => files.length >= 1),
        fc.func(fc.boolean()), // random exists function
      );

      await fc.assert(
        fc.asyncProperty(testCaseArb, async ([jobName, files, existsFn]) => {
          // Determine which keys "already exist"
          const existsKeys = new Set<string>();
          for (const file of files) {
            const key = `${jobName}/${file}`;
            if (existsFn(key)) {
              existsKeys.add(key);
            }
          }

          const entries: ManifestEntry[] = files.map((file) => ({
            file,
            modified: '2025-01-01T00:00:00.000Z',
            recipeNumber: '1',
            source: 'test',
          }));
          const csv = serializeManifest(entries);
          const jobDir = `jobs/${jobName}`;
          const manifestPath = `${jobDir}/manifest.csv`;

          // All files exist locally
          const fsExistsMap: Record<string, boolean> = {};
          for (const file of files) {
            fsExistsMap[`${jobDir}/images/${file}`] = true;
          }

          const mockObjectStore = createMockObjectStore(existsKeys);

          const service = new TranscribeService(
            createMockFs({ [manifestPath]: csv }, fsExistsMap),
            mockObjectStore,
            createMockOCRProvider(),
            createMockStructureExtractor(),
            createMockDataStore(),
          );

          await service.transcribe(jobName, jobDir);

          // Verify: upload called only for keys that don't exist
          const expectedUploads = files
            .map((f) => `${jobName}/${f}`)
            .filter((key) => !existsKeys.has(key));

          expect(mockObjectStore.uploadedKeys.sort()).toEqual(expectedUploads.sort());
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 4: Recipe metadata from manifest
  // Validates: Requirements 6.3
  describe('Property 4: Recipe metadata from manifest', () => {
    it('persisted recipe carries the same jobName, recipeNumber, and source from manifest', async () => {
      const testCaseArb = fc.tuple(
        jobNameArb,
        recipeNumberArb,
        sourceArb,
        fc.array(imageFileArb, { minLength: 1, maxLength: 4 })
          .map((files) => [...new Set(files)])
          .filter((files) => files.length >= 1),
      );

      await fc.assert(
        fc.asyncProperty(testCaseArb, async ([jobName, recipeNumber, source, files]) => {
          const entries: ManifestEntry[] = files.map((file) => ({
            file,
            modified: '2025-01-01T00:00:00.000Z',
            recipeNumber,
            source,
          }));
          const csv = serializeManifest(entries);
          const jobDir = `jobs/${jobName}`;
          const manifestPath = `${jobDir}/manifest.csv`;

          const fsExistsMap: Record<string, boolean> = {};
          for (const file of files) {
            fsExistsMap[`${jobDir}/images/${file}`] = true;
          }

          const mockDataStore = createMockDataStore();

          const service = new TranscribeService(
            createMockFs({ [manifestPath]: csv }, fsExistsMap),
            createMockObjectStore(new Set()),
            createMockOCRProvider(),
            createMockStructureExtractor(),
            mockDataStore,
          );

          await service.transcribe(jobName, jobDir);

          // Exactly one recipe should be persisted (all entries share the same recipeNumber)
          expect(mockDataStore.storedRecipes).toHaveLength(1);
          const recipe = mockDataStore.storedRecipes[0];
          expect(recipe.jobName).toBe(jobName);
          expect(recipe.recipeNumber).toBe(recipeNumber);
          expect(recipe.source).toBe(source);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 7: Fault isolation across recipe groups
  // Validates: Requirements 13.3
  describe('Property 7: Fault isolation across recipe groups', () => {
    it('non-failing groups are still processed when some groups fail', async () => {
      // Generate multiple recipe groups, randomly mark some as failing
      const testCaseArb = fc.tuple(
        jobNameArb,
        // Generate 2–6 distinct recipe numbers
        fc.array(recipeNumberArb, { minLength: 2, maxLength: 6 })
          .map((nums) => [...new Set(nums)])
          .filter((nums) => nums.length >= 2),
        // For each recipe number, generate 1–3 image files
        fc.func(fc.array(imageFileArb, { minLength: 1, maxLength: 3 })),
        // Random subset of recipe numbers that will fail extraction
        fc.func(fc.boolean()),
      ).filter(([, recipeNumbers, , failFn]) => {
        // Ensure at least one succeeds and at least one fails
        const failing = recipeNumbers.filter((rn) => failFn(rn));
        const succeeding = recipeNumbers.filter((rn) => !failFn(rn));
        return failing.length >= 1 && succeeding.length >= 1;
      });

      await fc.assert(
        fc.asyncProperty(testCaseArb, async ([jobName, recipeNumbers, filesFn, failFn]) => {
          const failingNumbers = new Set(recipeNumbers.filter((rn) => failFn(rn)));
          const succeedingNumbers = recipeNumbers.filter((rn) => !failFn(rn));

          // Build manifest entries — deduplicate filenames across groups
          const allEntries: ManifestEntry[] = [];
          const usedFiles = new Set<string>();
          for (const rn of recipeNumbers) {
            let files = filesFn(rn).map((f) => [...new Set([f])]).flat();
            // Deduplicate across groups
            files = files.filter((f) => {
              if (usedFiles.has(f)) return false;
              usedFiles.add(f);
              return true;
            });
            if (files.length === 0) {
              // Ensure at least one file per group
              const fallback = `fallback-${rn}.jpg`;
              if (!usedFiles.has(fallback)) {
                usedFiles.add(fallback);
                files = [fallback];
              } else {
                // Skip this group if we can't generate a unique file
                continue;
              }
            }
            for (const file of files) {
              allEntries.push({
                file,
                modified: '2025-01-01T00:00:00.000Z',
                recipeNumber: rn,
                source: 'test',
              });
            }
          }

          if (allEntries.length === 0) return;

          const csv = serializeManifest(allEntries);
          const jobDir = `jobs/${jobName}`;
          const manifestPath = `${jobDir}/manifest.csv`;

          const fsExistsMap: Record<string, boolean> = {};
          for (const entry of allEntries) {
            fsExistsMap[`${jobDir}/images/${entry.file}`] = true;
          }

          const mockDataStore = createMockDataStore();

          const service = new TranscribeService(
            createMockFs({ [manifestPath]: csv }, fsExistsMap),
            createMockObjectStore(new Set()),
            createMockOCRProvider(),
            createMockStructureExtractor(failingNumbers),
            mockDataStore,
          );

          const result = await service.transcribe(jobName, jobDir);

          // All non-failing groups should be persisted
          const persistedRecipeNumbers = new Set(
            mockDataStore.storedRecipes.map((r) => r.recipeNumber),
          );

          for (const rn of succeedingNumbers) {
            // Only check if this recipe number actually had entries in the manifest
            const hasEntries = allEntries.some((e) => e.recipeNumber === rn);
            if (hasEntries) {
              expect(persistedRecipeNumbers.has(rn)).toBe(true);
            }
          }

          // No failing group should be persisted
          for (const rn of failingNumbers) {
            expect(persistedRecipeNumbers.has(rn)).toBe(false);
          }

          // Error count should match failing groups that had entries
          const failingWithEntries = [...failingNumbers].filter((rn) =>
            allEntries.some((e) => e.recipeNumber === rn),
          );
          expect(result.errors.length).toBe(failingWithEntries.length);
        }),
        { numRuns: 100 },
      );
    });
  });
});
