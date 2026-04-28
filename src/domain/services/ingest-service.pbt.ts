import fc from 'fast-check';
import { IngestService } from './ingest-service.js';
import { parseManifest } from './csv-utils.js';
import { SUPPORTED_IMAGE_EXTENSIONS } from '../models/index.js';
import type { FileSystemPort } from '../ports/file-system-port.js';
import type { ManifestEntry } from '../models/index.js';

// Feature: cli-commands-implementation, Properties 7–8: IngestService correctness

// --- Supported and non-image extensions ---

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'];
const NON_IMAGE_EXTENSIONS = ['.txt', '.pdf', '.doc'];

// --- Arbitraries ---

/** Arbitrary that produces a safe base filename (no dots, no path separators). */
const baseNameArb = fc
  .stringMatching(/^[a-zA-Z0-9_-]{1,20}$/)
  .filter((s) => s.length >= 1);

/** Arbitrary that produces a filename with a supported image extension. */
const imageFileArb = fc
  .tuple(baseNameArb, fc.constantFrom(...IMAGE_EXTENSIONS))
  .map(([name, ext]) => name + ext);

/** Arbitrary that produces a filename with a non-image extension. */
const nonImageFileArb = fc
  .tuple(baseNameArb, fc.constantFrom(...NON_IMAGE_EXTENSIONS))
  .map(([name, ext]) => name + ext);

/** Arbitrary that produces a mixed array of image and non-image filenames. */
const mixedFilenamesArb = fc
  .tuple(
    fc.array(imageFileArb, { minLength: 1, maxLength: 15 }),
    fc.array(nonImageFileArb, { minLength: 0, maxLength: 5 }),
  )
  .map(([images, nonImages]) => [...images, ...nonImages])
  // Deduplicate filenames (case-sensitive)
  .map((files) => [...new Set(files)])
  // Ensure at least one image file survives dedup
  .filter((files) => files.some((f) => {
    const dotIdx = f.lastIndexOf('.');
    return dotIdx !== -1 && SUPPORTED_IMAGE_EXTENSIONS.has(f.substring(dotIdx).toLowerCase());
  }));

/** Arbitrary that produces valid ISO timestamps spread across a date range. */
const isoTimestampArb = fc
  .integer({
    min: new Date('2000-01-01T00:00:00.000Z').getTime(),
    max: new Date('2030-12-31T23:59:59.999Z').getTime(),
  })
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for non-empty recipe number strings. */
const recipeNumberArb = fc.stringMatching(/^[A-Za-z0-9 _-]{1,20}$/);

/** Arbitrary for non-empty source strings (simple text, no CSV-breaking chars for clarity). */
const sourceArb = fc.stringMatching(/^[A-Za-z0-9 _-]{1,30}$/);

// --- Mock FileSystemPort ---

/**
 * Creates a mock FileSystemPort that records calls and returns configurable responses.
 */
function createMockFs(overrides: {
  existsMap?: Record<string, boolean>;
  listDirectoryMap?: Record<string, string[]>;
  readFileMap?: Record<string, string>;
  modifiedTimeMap?: Record<string, Date>;
} = {}): FileSystemPort & {
  calls: { method: string; args: unknown[] }[];
  writtenFiles: Record<string, string>;
} {
  const {
    existsMap = {},
    listDirectoryMap = {},
    readFileMap = {},
    modifiedTimeMap = {},
  } = overrides;
  const calls: { method: string; args: unknown[] }[] = [];
  const writtenFiles: Record<string, string> = {};

  return {
    calls,
    writtenFiles,
    async createDirectory(path: string): Promise<void> {
      calls.push({ method: 'createDirectory', args: [path] });
    },
    async exists(path: string): Promise<boolean> {
      calls.push({ method: 'exists', args: [path] });
      return existsMap[path] ?? false;
    },
    async getFileModifiedTime(path: string): Promise<Date> {
      calls.push({ method: 'getFileModifiedTime', args: [path] });
      return modifiedTimeMap[path] ?? new Date('2020-01-01T00:00:00.000Z');
    },
    async listDirectory(path: string): Promise<string[]> {
      calls.push({ method: 'listDirectory', args: [path] });
      return listDirectoryMap[path] ?? [];
    },
    async readFile(path: string): Promise<string> {
      calls.push({ method: 'readFile', args: [path] });
      return readFileMap[path] ?? '';
    },
    async writeFile(path: string, content: string): Promise<void> {
      calls.push({ method: 'writeFile', args: [path, content] });
      writtenFiles[path] = content;
    },
  };
}

// --- Helper: check if a filename has a supported image extension ---

function isImageFile(fileName: string): boolean {
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return SUPPORTED_IMAGE_EXTENSIONS.has(fileName.substring(dotIdx).toLowerCase());
}

describe('IngestService (property-based)', () => {
  // **Validates: Requirements 5.1, 5.2, 5.3, 5.7, 5.8**

  // Feature: cli-commands-implementation, Property 7: Ingest produces a correct manifest from image files
  describe('Property 7: Ingest produces a correct manifest from image files', () => {
    it('produces a manifest containing exactly the supported image files, sorted by modified date ascending, with empty annotations', async () => {
      await fc.assert(
        fc.asyncProperty(
          mixedFilenamesArb,
          fc.array(isoTimestampArb, { minLength: 20, maxLength: 20 }),
          async (filenames, timestamps) => {
            const jobDir = 'jobs/test-job';
            const imagesDir = `${jobDir}/images`;
            const manifestPath = `${jobDir}/manifest.csv`;

            // Assign a unique modified time to each file
            const modifiedTimeMap: Record<string, Date> = {};
            filenames.forEach((f, i) => {
              modifiedTimeMap[`${imagesDir}/${f}`] = new Date(timestamps[i % timestamps.length]);
            });

            const mockFs = createMockFs({
              listDirectoryMap: { [imagesDir]: filenames },
              existsMap: { [manifestPath]: false },
              modifiedTimeMap,
            });

            const service = new IngestService(mockFs);
            const result = await service.ingest(jobDir);

            // Parse the written manifest
            const writtenCsv = mockFs.writtenFiles[manifestPath];
            expect(writtenCsv).toBeDefined();
            const manifest = parseManifest(writtenCsv);

            // Only image files should be in the manifest
            const expectedImageFiles = filenames.filter(isImageFile);
            expect(manifest).toHaveLength(expectedImageFiles.length);
            expect(result.total).toBe(expectedImageFiles.length);
            expect(result.discovered).toBe(expectedImageFiles.length);

            // Every manifest entry should be an image file from the input
            const manifestFileSet = new Set(manifest.map((e) => e.file));
            const expectedFileSet = new Set(expectedImageFiles);
            expect(manifestFileSet).toEqual(expectedFileSet);

            // Each entry should have file and modified populated, annotations empty
            for (const entry of manifest) {
              expect(entry.file.length).toBeGreaterThan(0);
              expect(entry.modified.length).toBeGreaterThan(0);
              expect(entry.recipeNumber).toBe('');
              expect(entry.source).toBe('');
            }

            // Entries should be sorted by modified date ascending
            for (let i = 1; i < manifest.length; i++) {
              expect(manifest[i].modified >= manifest[i - 1].modified).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: cli-commands-implementation, Property 8: Manifest merge preserves annotations and avoids duplicates
  describe('Property 8: Manifest merge preserves annotations and avoids duplicates', () => {
    it('preserves annotations on existing rows, avoids duplicates, adds new images with empty annotations, and updates modified timestamps', async () => {
      /**
       * Strategy:
       * - Generate a set of "existing" image filenames with annotations (recipeNumber, source)
       * - Generate a set of "new" image filenames (some may overlap with existing)
       * - The combined set goes into the images directory listing
       * - The existing manifest CSV is built from the existing entries
       * - After ingest, verify the four sub-properties (a)–(d)
       */
      const existingEntryArb = fc
        .tuple(imageFileArb, isoTimestampArb, recipeNumberArb, sourceArb)
        .map(([file, modified, recipeNumber, source]): ManifestEntry => ({
          file,
          modified,
          recipeNumber,
          source,
        }));

      await fc.assert(
        fc.asyncProperty(
          // Existing annotated entries (1–8)
          fc.array(existingEntryArb, { minLength: 1, maxLength: 8 })
            .map((entries) => {
              // Deduplicate by filename
              const seen = new Set<string>();
              return entries.filter((e) => {
                if (seen.has(e.file)) return false;
                seen.add(e.file);
                return true;
              });
            })
            .filter((entries) => entries.length >= 1),
          // New image filenames (0–5)
          fc.array(imageFileArb, { minLength: 0, maxLength: 5 }),
          // Timestamps for modified times (fresh values)
          fc.array(isoTimestampArb, { minLength: 20, maxLength: 20 }),
          async (existingEntries, newImageFiles, timestamps) => {
            const jobDir = 'jobs/merge-job';
            const imagesDir = `${jobDir}/images`;
            const manifestPath = `${jobDir}/manifest.csv`;

            // Deduplicate new files and remove any that collide with existing
            const existingFileSet = new Set(existingEntries.map((e) => e.file));
            const uniqueNewFiles = [...new Set(newImageFiles)].filter(
              (f) => !existingFileSet.has(f),
            );

            // The full set of image files on disk = existing + new
            const allImageFiles = [
              ...existingEntries.map((e) => e.file),
              ...uniqueNewFiles,
            ];

            // Build modified time map — fresh timestamps for all files
            const modifiedTimeMap: Record<string, Date> = {};
            allImageFiles.forEach((f, i) => {
              modifiedTimeMap[`${imagesDir}/${f}`] = new Date(timestamps[i % timestamps.length]);
            });

            // Build existing manifest CSV using serializeManifest-like format
            // We'll build it manually to ensure the mock returns valid CSV
            const { serializeManifest } = await import('./csv-utils.js');
            const existingCsv = serializeManifest(existingEntries);

            const mockFs = createMockFs({
              listDirectoryMap: { [imagesDir]: allImageFiles },
              existsMap: { [manifestPath]: true },
              readFileMap: { [manifestPath]: existingCsv },
              modifiedTimeMap,
            });

            const service = new IngestService(mockFs);
            const result = await service.ingest(jobDir);

            // Parse the written manifest
            const writtenCsv = mockFs.writtenFiles[manifestPath];
            expect(writtenCsv).toBeDefined();
            const manifest = parseManifest(writtenCsv);

            // (b) No filename appears more than once
            const fileNames = manifest.map((e) => e.file);
            expect(new Set(fileNames).size).toBe(fileNames.length);

            // Total should equal all unique image files
            expect(manifest).toHaveLength(allImageFiles.length);
            expect(result.total).toBe(allImageFiles.length);
            expect(result.discovered).toBe(uniqueNewFiles.length);

            // (a) Previously annotated rows retain their recipeNumber and source
            for (const existing of existingEntries) {
              const found = manifest.find((e) => e.file === existing.file);
              expect(found).toBeDefined();
              expect(found!.recipeNumber).toBe(existing.recipeNumber);
              expect(found!.source).toBe(existing.source);
            }

            // (c) Newly discovered images have empty annotation columns
            for (const newFile of uniqueNewFiles) {
              const found = manifest.find((e) => e.file === newFile);
              expect(found).toBeDefined();
              expect(found!.recipeNumber).toBe('');
              expect(found!.source).toBe('');
            }

            // (d) Modified timestamps are updated to current values for all entries
            for (const entry of manifest) {
              const expectedDate = modifiedTimeMap[`${imagesDir}/${entry.file}`];
              expect(entry.modified).toBe(expectedDate.toISOString());
            }

            // Entries should be sorted by modified date ascending
            for (let i = 1; i < manifest.length; i++) {
              expect(manifest[i].modified >= manifest[i - 1].modified).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
