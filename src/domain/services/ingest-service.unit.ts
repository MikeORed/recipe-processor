import { IngestService } from './ingest-service.js';
import type { FileSystemPort } from '../ports/file-system-port.js';
import { HeirloomError } from '../../shared/errors.js';
import { parseManifest, serializeManifest } from './csv-utils.js';

/**
 * Creates a mock FileSystemPort with configurable responses.
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
      return modifiedTimeMap[path] ?? new Date('2025-01-01T00:00:00.000Z');
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

describe('IngestService', () => {
  describe('fresh ingest with mixed files', () => {
    it('includes only image files in the manifest and ignores non-image files', async () => {
      const mockFs = createMockFs({
        listDirectoryMap: {
          'jobs/batch1/images': ['photo1.jpg', 'photo2.png', 'readme.txt', 'notes.pdf', 'scan.tiff'],
        },
        existsMap: {
          'jobs/batch1/manifest.csv': false,
        },
        modifiedTimeMap: {
          'jobs/batch1/images/photo1.jpg': new Date('2025-01-10T08:00:00.000Z'),
          'jobs/batch1/images/photo2.png': new Date('2025-01-11T09:00:00.000Z'),
          'jobs/batch1/images/scan.tiff': new Date('2025-01-12T10:00:00.000Z'),
        },
      });
      const service = new IngestService(mockFs);

      const result = await service.ingest('jobs/batch1');

      expect(result.discovered).toBe(3);
      expect(result.total).toBe(3);

      const csv = mockFs.writtenFiles['jobs/batch1/manifest.csv'];
      expect(csv).toBeDefined();

      const entries = parseManifest(csv);
      expect(entries).toHaveLength(3);

      const fileNames = entries.map((e) => e.file);
      expect(fileNames).toContain('photo1.jpg');
      expect(fileNames).toContain('photo2.png');
      expect(fileNames).toContain('scan.tiff');
      expect(fileNames).not.toContain('readme.txt');
      expect(fileNames).not.toContain('notes.pdf');

      // All entries should have correct fields and empty annotations
      for (const entry of entries) {
        expect(entry.file).toBeTruthy();
        expect(entry.modified).toBeTruthy();
        expect(entry.recipeNumber).toBe('');
        expect(entry.source).toBe('');
      }
    });
  });

  describe('merge with existing manifest', () => {
    it('preserves annotations on existing entries and adds new files', async () => {
      const existingEntries = [
        { file: 'old-photo.jpg', modified: '2025-01-05T00:00:00.000Z', recipeNumber: '42', source: 'Grandma' },
      ];
      const existingCsv = serializeManifest(existingEntries);

      const mockFs = createMockFs({
        listDirectoryMap: {
          'jobs/batch1/images': ['old-photo.jpg', 'new-photo.png'],
        },
        existsMap: {
          'jobs/batch1/manifest.csv': true,
        },
        readFileMap: {
          'jobs/batch1/manifest.csv': existingCsv,
        },
        modifiedTimeMap: {
          'jobs/batch1/images/old-photo.jpg': new Date('2025-01-06T12:00:00.000Z'),
          'jobs/batch1/images/new-photo.png': new Date('2025-01-07T14:00:00.000Z'),
        },
      });
      const service = new IngestService(mockFs);

      const result = await service.ingest('jobs/batch1');

      // Only the new file counts as discovered
      expect(result.discovered).toBe(1);
      expect(result.total).toBe(2);

      const csv = mockFs.writtenFiles['jobs/batch1/manifest.csv'];
      const entries = parseManifest(csv);
      expect(entries).toHaveLength(2);

      // Existing entry preserves annotations, modified timestamp is updated
      const oldEntry = entries.find((e) => e.file === 'old-photo.jpg');
      expect(oldEntry).toBeDefined();
      expect(oldEntry!.recipeNumber).toBe('42');
      expect(oldEntry!.source).toBe('Grandma');
      expect(oldEntry!.modified).toBe('2025-01-06T12:00:00.000Z');

      // New entry has empty annotations
      const newEntry = entries.find((e) => e.file === 'new-photo.png');
      expect(newEntry).toBeDefined();
      expect(newEntry!.recipeNumber).toBe('');
      expect(newEntry!.source).toBe('');
      expect(newEntry!.modified).toBe('2025-01-07T14:00:00.000Z');

      // No duplicates
      const fileNames = entries.map((e) => e.file);
      expect(new Set(fileNames).size).toBe(fileNames.length);
    });
  });

  describe('no images error', () => {
    it('throws HeirloomError when directory contains only non-image files', async () => {
      const mockFs = createMockFs({
        listDirectoryMap: {
          'jobs/batch1/images': ['readme.txt', 'notes.pdf'],
        },
      });
      const service = new IngestService(mockFs);

      await expect(service.ingest('jobs/batch1')).rejects.toThrow(HeirloomError);
      await expect(service.ingest('jobs/batch1')).rejects.toThrow(/No image files found/);
    });

    it('throws HeirloomError when images directory is empty', async () => {
      const mockFs = createMockFs({
        listDirectoryMap: {
          'jobs/batch1/images': [],
        },
      });
      const service = new IngestService(mockFs);

      await expect(service.ingest('jobs/batch1')).rejects.toThrow(HeirloomError);
      await expect(service.ingest('jobs/batch1')).rejects.toThrow(/No image files found/);
    });
  });

  describe('sorting by filename ascending', () => {
    it('writes manifest entries sorted by filename ascending', async () => {
      const mockFs = createMockFs({
        listDirectoryMap: {
          'jobs/batch1/images': ['c.jpg', 'a.png', 'b.jpeg'],
        },
        existsMap: {
          'jobs/batch1/manifest.csv': false,
        },
        modifiedTimeMap: {
          'jobs/batch1/images/c.jpg': new Date('2025-03-01T00:00:00.000Z'),
          'jobs/batch1/images/a.png': new Date('2025-01-01T00:00:00.000Z'),
          'jobs/batch1/images/b.jpeg': new Date('2025-02-01T00:00:00.000Z'),
        },
      });
      const service = new IngestService(mockFs);

      await service.ingest('jobs/batch1');

      const csv = mockFs.writtenFiles['jobs/batch1/manifest.csv'];
      const entries = parseManifest(csv);
      expect(entries).toHaveLength(3);

      // Verify ascending order by filename
      expect(entries[0].file).toBe('a.png');
      expect(entries[1].file).toBe('b.jpeg');
      expect(entries[2].file).toBe('c.jpg');
    });
  });
});
