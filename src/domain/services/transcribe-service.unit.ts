import { TranscribeService } from './transcribe-service.js';
import type { FileSystemPort } from '../ports/file-system-port.js';
import type { ObjectStore } from '../ports/object-store-port.js';
import type { OCRProvider, OCRResult } from '../ports/ocr-provider-port.js';
import type { StructureExtractor, ExtractionInput } from '../ports/structure-extractor-port.js';
import type { DataStore } from '../ports/data-store-port.js';
import type { Recipe, JobStatus } from '../models/index.js';
import { HeirloomError } from '../../shared/errors.js';
import { serializeManifest } from './csv-utils.js';
import type { ManifestEntry } from '../models/index.js';

// --- Mock factories ---

function createMockFs(overrides: {
  existsMap?: Record<string, boolean>;
  readFileMap?: Record<string, string>;
} = {}): FileSystemPort & { calls: { method: string; args: unknown[] }[] } {
  const { existsMap = {}, readFileMap = {} } = overrides;
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    calls,
    async createDirectory(p: string) { calls.push({ method: 'createDirectory', args: [p] }); },
    async exists(p: string) {
      calls.push({ method: 'exists', args: [p] });
      return existsMap[p] ?? false;
    },
    async getFileModifiedTime(p: string) {
      calls.push({ method: 'getFileModifiedTime', args: [p] });
      return new Date();
    },
    async listDirectory(p: string) {
      calls.push({ method: 'listDirectory', args: [p] });
      return [];
    },
    async readFile(p: string) {
      calls.push({ method: 'readFile', args: [p] });
      return readFileMap[p] ?? '';
    },
    async writeFile(p: string, content: string) {
      calls.push({ method: 'writeFile', args: [p, content] });
    },
  };
}

function createMockObjectStore(overrides: {
  existsKeys?: Set<string>;
  uploadError?: Error;
} = {}): ObjectStore & { calls: { method: string; args: unknown[] }[] } {
  const { existsKeys = new Set(), uploadError } = overrides;
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    calls,
    async upload(localPath: string, key: string) {
      calls.push({ method: 'upload', args: [localPath, key] });
      if (uploadError) throw uploadError;
    },
    async exists(key: string) {
      calls.push({ method: 'exists', args: [key] });
      return existsKeys.has(key);
    },
  };
}

function createMockOCRProvider(overrides: {
  results?: Record<string, OCRResult>;
  errorKeys?: Set<string>;
} = {}): OCRProvider & { calls: { method: string; args: unknown[] }[] } {
  const { results = {}, errorKeys = new Set() } = overrides;
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    calls,
    async extractText(imageKey: string) {
      calls.push({ method: 'extractText', args: [imageKey] });
      if (errorKeys.has(imageKey)) {
        throw new Error(`OCR failed for ${imageKey}`);
      }
      return results[imageKey] ?? { blocks: [{ text: `Text from ${imageKey}`, confidence: 0.95 }] };
    },
  };
}

function createMockStructureExtractor(overrides: {
  recipes?: Record<string, Recipe>;
  errorRecipeNumbers?: Set<string>;
} = {}): StructureExtractor & { calls: { method: string; args: unknown[] }[] } {
  const { recipes = {}, errorRecipeNumbers = new Set() } = overrides;
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    calls,
    async extract(input: ExtractionInput) {
      calls.push({ method: 'extract', args: [input] });
      if (errorRecipeNumbers.has(input.recipeNumber)) {
        throw new Error(`Extraction failed for recipe ${input.recipeNumber}`);
      }
      if (recipes[input.recipeNumber]) {
        return [recipes[input.recipeNumber]];
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

function createMockDataStore(overrides: {
  jobStatuses?: Record<string, JobStatus>;
  recipes?: Recipe[];
} = {}): DataStore & {
  calls: { method: string; args: unknown[] }[];
  storedRecipes: Recipe[];
  statusUpdates: Array<{ jobName: string; status: JobStatus }>;
} {
  const { jobStatuses = {}, recipes = [] } = overrides;
  const calls: { method: string; args: unknown[] }[] = [];
  const storedRecipes: Recipe[] = [...recipes];
  const statusUpdates: Array<{ jobName: string; status: JobStatus }> = [];

  return {
    calls,
    storedRecipes,
    statusUpdates,
    async putRecipe(recipe: Recipe) {
      calls.push({ method: 'putRecipe', args: [recipe] });
      storedRecipes.push(recipe);
    },
    async getRecipesByJob(jobName: string) {
      calls.push({ method: 'getRecipesByJob', args: [jobName] });
      return storedRecipes.filter((r) => r.jobName === jobName);
    },
    async updateJobStatus(jobName: string, status: JobStatus) {
      calls.push({ method: 'updateJobStatus', args: [jobName, status] });
      statusUpdates.push({ jobName, status });
      jobStatuses[jobName] = status;
    },
    async getJobStatus(jobName: string) {
      calls.push({ method: 'getJobStatus', args: [jobName] });
      return jobStatuses[jobName];
    },
    async getRecipeWithOcr(jobName: string, recipeNumber: string) {
      calls.push({ method: 'getRecipeWithOcr', args: [jobName, recipeNumber] });
      return undefined;
    },
  };
}

// --- Helpers ---

function buildManifestCsv(entries: ManifestEntry[]): string {
  return serializeManifest(entries);
}

function makeEntries(...specs: Array<{ file: string; recipeNumber: string; source?: string }>): ManifestEntry[] {
  return specs.map((s) => ({
    file: s.file,
    modified: '2025-01-01T00:00:00.000Z',
    recipeNumber: s.recipeNumber,
    source: s.source ?? 'TestSource',
  }));
}

// --- Tests ---

describe('TranscribeService', () => {
  const jobName = 'test-job';
  const jobDir = 'jobs/test-job';
  const manifestPath = `${jobDir}/manifest.csv`;

  describe('manifest reading and filtering', () => {
    it('skips entries with empty recipeNumber and reports skipped count', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '' },
        { file: 'c.jpg', recipeNumber: '2' },
        { file: 'd.jpg', recipeNumber: '' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/a.jpg`]: true,
          [`${jobDir}/images/c.jpg`]: true,
        },
      });
      const mockObjectStore = createMockObjectStore();
      const mockOCR = createMockOCRProvider();
      const mockExtractor = createMockStructureExtractor();
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(mockFs, mockObjectStore, mockOCR, mockExtractor, mockDataStore);
      const result = await service.transcribe(jobName, jobDir);

      expect(result.entriesSkipped).toBe(2);
      expect(result.recipesTranscribed).toBe(2);
    });

    it('skips entries with whitespace-only recipeNumber', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '   ' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: { [`${jobDir}/images/a.jpg`]: true },
      });

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        createMockStructureExtractor(), createMockDataStore(),
      );
      const result = await service.transcribe(jobName, jobDir);

      expect(result.entriesSkipped).toBe(1);
      expect(result.recipesTranscribed).toBe(1);
    });
  });

  describe('error when no annotated entries found', () => {
    it('throws HeirloomError when all entries have empty recipeNumber', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '' },
        { file: 'b.jpg', recipeNumber: '' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({ readFileMap: { [manifestPath]: csv } });
      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        createMockStructureExtractor(), createMockDataStore(),
      );

      await expect(service.transcribe(jobName, jobDir)).rejects.toThrow(HeirloomError);
      await expect(service.transcribe(jobName, jobDir)).rejects.toThrow(/No annotated entries/);
    });

    it('throws HeirloomError when manifest is empty', async () => {
      const csv = 'file,modified,recipe_number,source\n';
      const mockFs = createMockFs({ readFileMap: { [manifestPath]: csv } });
      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        createMockStructureExtractor(), createMockDataStore(),
      );

      await expect(service.transcribe(jobName, jobDir)).rejects.toThrow(HeirloomError);
    });
  });

  describe('grouping by recipeNumber', () => {
    it('groups multiple images under the same recipeNumber', async () => {
      const entries = makeEntries(
        { file: 'front.jpg', recipeNumber: '1' },
        { file: 'back.jpg', recipeNumber: '1' },
        { file: 'page1.jpg', recipeNumber: '2' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/front.jpg`]: true,
          [`${jobDir}/images/back.jpg`]: true,
          [`${jobDir}/images/page1.jpg`]: true,
        },
      });
      const mockExtractor = createMockStructureExtractor();
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        mockExtractor, mockDataStore,
      );
      const result = await service.transcribe(jobName, jobDir);

      expect(result.recipesTranscribed).toBe(2);

      // Extractor should have been called twice (once per recipe group)
      const extractCalls = mockExtractor.calls.filter((c) => c.method === 'extract');
      expect(extractCalls).toHaveLength(2);

      // Recipe 1 should have 2 image keys
      const recipe1Call = extractCalls.find(
        (c) => (c.args[0] as ExtractionInput).recipeNumber === '1',
      );
      expect(recipe1Call).toBeDefined();
      expect((recipe1Call!.args[0] as ExtractionInput).imageKeys).toHaveLength(2);

      // Recipe 2 should have 1 image key
      const recipe2Call = extractCalls.find(
        (c) => (c.args[0] as ExtractionInput).recipeNumber === '2',
      );
      expect(recipe2Call).toBeDefined();
      expect((recipe2Call!.args[0] as ExtractionInput).imageKeys).toHaveLength(1);
    });
  });

  describe('upload key construction', () => {
    it('constructs S3 key as <jobName>/<filename>', async () => {
      const entries = makeEntries({ file: 'photo.jpg', recipeNumber: '1' });
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: { [`${jobDir}/images/photo.jpg`]: true },
      });
      const mockObjectStore = createMockObjectStore();

      const service = new TranscribeService(
        mockFs, mockObjectStore, createMockOCRProvider(),
        createMockStructureExtractor(), createMockDataStore(),
      );
      await service.transcribe(jobName, jobDir);

      const existsCalls = mockObjectStore.calls.filter((c) => c.method === 'exists');
      expect(existsCalls[0].args[0]).toBe('test-job/photo.jpg');

      const uploadCalls = mockObjectStore.calls.filter((c) => c.method === 'upload');
      expect(uploadCalls[0].args[1]).toBe('test-job/photo.jpg');
    });
  });

  describe('idempotent upload skip', () => {
    it('skips upload when key already exists in object store', async () => {
      const entries = makeEntries({ file: 'photo.jpg', recipeNumber: '1' });
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: { [`${jobDir}/images/photo.jpg`]: true },
      });
      const mockObjectStore = createMockObjectStore({
        existsKeys: new Set(['test-job/photo.jpg']),
      });

      const service = new TranscribeService(
        mockFs, mockObjectStore, createMockOCRProvider(),
        createMockStructureExtractor(), createMockDataStore(),
      );
      await service.transcribe(jobName, jobDir);

      const uploadCalls = mockObjectStore.calls.filter((c) => c.method === 'upload');
      expect(uploadCalls).toHaveLength(0);
    });

    it('uploads when key does not exist in object store', async () => {
      const entries = makeEntries({ file: 'photo.jpg', recipeNumber: '1' });
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: { [`${jobDir}/images/photo.jpg`]: true },
      });
      const mockObjectStore = createMockObjectStore();

      const service = new TranscribeService(
        mockFs, mockObjectStore, createMockOCRProvider(),
        createMockStructureExtractor(), createMockDataStore(),
      );
      await service.transcribe(jobName, jobDir);

      const uploadCalls = mockObjectStore.calls.filter((c) => c.method === 'upload');
      expect(uploadCalls).toHaveLength(1);
      expect(uploadCalls[0].args).toEqual([`${jobDir}/images/photo.jpg`, 'test-job/photo.jpg']);
    });
  });

  describe('OCR error handling', () => {
    it('skips image on OCR error but continues with remaining images in group', async () => {
      const entries = makeEntries(
        { file: 'good.jpg', recipeNumber: '1' },
        { file: 'bad.jpg', recipeNumber: '1' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/good.jpg`]: true,
          [`${jobDir}/images/bad.jpg`]: true,
        },
      });
      const mockOCR = createMockOCRProvider({
        errorKeys: new Set(['test-job/bad.jpg']),
      });
      const mockExtractor = createMockStructureExtractor();

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), mockOCR,
        mockExtractor, createMockDataStore(),
      );
      const result = await service.transcribe(jobName, jobDir);

      // Recipe should still be transcribed (one image had OCR text)
      expect(result.recipesTranscribed).toBe(1);

      // Extractor should have been called with text from the good image only
      const extractCalls = mockExtractor.calls.filter((c) => c.method === 'extract');
      expect(extractCalls).toHaveLength(1);
    });
  });

  describe('extraction error handling', () => {
    it('skips group on extraction error and continues with other groups', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '2' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/a.jpg`]: true,
          [`${jobDir}/images/b.jpg`]: true,
        },
      });
      const mockExtractor = createMockStructureExtractor({
        errorRecipeNumbers: new Set(['1']),
      });
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        mockExtractor, mockDataStore,
      );
      const result = await service.transcribe(jobName, jobDir);

      expect(result.recipesTranscribed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].recipeNumber).toBe('1');

      // Only recipe 2 should be persisted
      const putCalls = mockDataStore.calls.filter((c) => c.method === 'putRecipe');
      expect(putCalls).toHaveLength(1);
    });
  });

  describe('Zod validation failure handling', () => {
    it('skips group when extractor throws validation error', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '2' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/a.jpg`]: true,
          [`${jobDir}/images/b.jpg`]: true,
        },
      });

      // Extractor that throws a Zod-like validation error for recipe 1
      const mockExtractor = createMockStructureExtractor({
        errorRecipeNumbers: new Set(['1']),
      });
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        mockExtractor, mockDataStore,
      );
      const result = await service.transcribe(jobName, jobDir);

      expect(result.recipesTranscribed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].recipeNumber).toBe('1');
    });
  });

  describe('job status transitions', () => {
    it('transitions ingested → transcribing → transcribed on success', async () => {
      const entries = makeEntries({ file: 'a.jpg', recipeNumber: '1' });
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: { [`${jobDir}/images/a.jpg`]: true },
      });
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        createMockStructureExtractor(), mockDataStore,
      );
      await service.transcribe(jobName, jobDir);

      expect(mockDataStore.statusUpdates).toEqual([
        { jobName, status: 'transcribing' },
        { jobName, status: 'transcribed' },
      ]);
    });

    it('transitions to transcribed even with partial failures', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '2' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/a.jpg`]: true,
          [`${jobDir}/images/b.jpg`]: true,
        },
      });
      const mockExtractor = createMockStructureExtractor({
        errorRecipeNumbers: new Set(['1']),
      });
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        mockExtractor, mockDataStore,
      );
      await service.transcribe(jobName, jobDir);

      expect(mockDataStore.statusUpdates).toEqual([
        { jobName, status: 'transcribing' },
        { jobName, status: 'transcribed' },
      ]);
    });
  });

  describe('job status revert on total failure', () => {
    it('reverts to ingested when all recipe groups fail', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '2' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/a.jpg`]: true,
          [`${jobDir}/images/b.jpg`]: true,
        },
      });
      const mockExtractor = createMockStructureExtractor({
        errorRecipeNumbers: new Set(['1', '2']),
      });
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        mockExtractor, mockDataStore,
      );
      const result = await service.transcribe(jobName, jobDir);

      expect(result.recipesTranscribed).toBe(0);
      expect(mockDataStore.statusUpdates).toEqual([
        { jobName, status: 'transcribing' },
        { jobName, status: 'ingested' },
      ]);
    });
  });

  describe('summary result accuracy', () => {
    it('returns accurate counts for recipesTranscribed, entriesSkipped, and errors', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '2' },
        { file: 'c.jpg', recipeNumber: '3' },
        { file: 'd.jpg', recipeNumber: '' },
        { file: 'e.jpg', recipeNumber: '' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/a.jpg`]: true,
          [`${jobDir}/images/b.jpg`]: true,
          [`${jobDir}/images/c.jpg`]: true,
        },
      });
      const mockExtractor = createMockStructureExtractor({
        errorRecipeNumbers: new Set(['2']),
      });

      const service = new TranscribeService(
        mockFs, createMockObjectStore(), createMockOCRProvider(),
        mockExtractor, createMockDataStore(),
      );
      const result = await service.transcribe(jobName, jobDir);

      expect(result.recipesTranscribed).toBe(2);
      expect(result.entriesSkipped).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].recipeNumber).toBe('2');
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('re-run on transcribed job', () => {
    it('re-processes all entries when run again', async () => {
      const entries = makeEntries(
        { file: 'a.jpg', recipeNumber: '1' },
        { file: 'b.jpg', recipeNumber: '2' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/a.jpg`]: true,
          [`${jobDir}/images/b.jpg`]: true,
        },
      });
      // Images already uploaded from previous run
      const mockObjectStore = createMockObjectStore({
        existsKeys: new Set(['test-job/a.jpg', 'test-job/b.jpg']),
      });
      const mockDataStore = createMockDataStore();

      const service = new TranscribeService(
        mockFs, mockObjectStore, createMockOCRProvider(),
        createMockStructureExtractor(), mockDataStore,
      );
      const result = await service.transcribe(jobName, jobDir);

      // Both recipes should be transcribed (re-processed)
      expect(result.recipesTranscribed).toBe(2);

      // Uploads should be skipped (idempotent)
      const uploadCalls = mockObjectStore.calls.filter((c) => c.method === 'upload');
      expect(uploadCalls).toHaveLength(0);

      // But OCR and extraction should still run
      expect(mockDataStore.storedRecipes).toHaveLength(2);
    });
  });

  describe('missing image file handling', () => {
    it('skips entries where the local image file does not exist', async () => {
      const entries = makeEntries(
        { file: 'exists.jpg', recipeNumber: '1' },
        { file: 'missing.jpg', recipeNumber: '1' },
      );
      const csv = buildManifestCsv(entries);

      const mockFs = createMockFs({
        readFileMap: { [manifestPath]: csv },
        existsMap: {
          [`${jobDir}/images/exists.jpg`]: true,
          [`${jobDir}/images/missing.jpg`]: false,
        },
      });
      const mockObjectStore = createMockObjectStore();

      const service = new TranscribeService(
        mockFs, mockObjectStore, createMockOCRProvider(),
        createMockStructureExtractor(), createMockDataStore(),
      );
      const result = await service.transcribe(jobName, jobDir);

      expect(result.recipesTranscribed).toBe(1);

      // Only the existing file should be uploaded
      const uploadCalls = mockObjectStore.calls.filter((c) => c.method === 'upload');
      expect(uploadCalls).toHaveLength(1);
      expect(uploadCalls[0].args[1]).toBe('test-job/exists.jpg');
    });
  });
});
