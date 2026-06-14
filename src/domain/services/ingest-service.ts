import type { FileSystemPort } from '../ports/file-system-port.js';
import type { ManifestEntry } from '../models/index.js';
import { SUPPORTED_IMAGE_EXTENSIONS } from '../models/index.js';
import { HeirloomError } from '../../shared/errors.js';
import { parseManifest, serializeManifest } from './csv-utils.js';

export class IngestService {
  constructor(private readonly fs: FileSystemPort) {}

  /**
   * Scan a job's images directory for supported image files, generate or
   * merge a manifest CSV, and return discovery counts.
   *
   * - Filters files by SUPPORTED_IMAGE_EXTENSIONS
   * - Reads file modified timestamps via FileSystemPort.getFileModifiedTime
   * - Merges with existing manifest.csv if present, preserving annotations
   * - Sorts entries by modified date ascending
   * - Writes result to <jobDir>/manifest.csv
   *
   * @returns discovered — number of new images added; total — all manifest rows
   * @throws HeirloomError if no image files are found
   */
  async ingest(jobDir: string): Promise<{ discovered: number; total: number }> {
    const imagesDir = `${jobDir}/images`;
    const manifestPath = `${jobDir}/manifest.csv`;

    // Scan images directory for files with supported extensions
    const allFiles = await this.fs.listDirectory(imagesDir);
    const imageFiles = allFiles.filter((fileName) => {
      const dotIndex = fileName.lastIndexOf('.');
      if (dotIndex === -1) return false;
      const ext = fileName.substring(dotIndex).toLowerCase();
      return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
    });

    if (imageFiles.length === 0) {
      throw new HeirloomError(`No image files found in ${imagesDir}`);
    }

    // Read existing manifest if present, index by filename for merge
    const existingByFile = new Map<string, ManifestEntry>();
    if (await this.fs.exists(manifestPath)) {
      const csv = await this.fs.readFile(manifestPath);
      const existing = parseManifest(csv);
      for (const entry of existing) {
        existingByFile.set(entry.file, entry);
      }
    }

    // Build manifest entries: merge with existing, preserving annotations
    let discovered = 0;
    const entries: ManifestEntry[] = [];

    for (const fileName of imageFiles) {
      const filePath = `${imagesDir}/${fileName}`;
      const modifiedDate = await this.fs.getFileModifiedTime(filePath);
      const modifiedIso = modifiedDate.toISOString();

      const existing = existingByFile.get(fileName);
      if (existing) {
        // Preserve annotations, update modified timestamp
        entries.push({
          file: fileName,
          modified: modifiedIso,
          recipeNumber: existing.recipeNumber,
          source: existing.source,
        });
      } else {
        // New image — empty annotations
        discovered++;
        entries.push({
          file: fileName,
          modified: modifiedIso,
          recipeNumber: '',
          source: '',
        });
      }
    }

    // Sort by filename ascending — works for both timestamp-named files
    // (e.g. 20260427_151228.jpg, Scan_20260613_164122.jpg) and user-named
    // files (e.g. 01-grandmas-cake.jpg) since lexicographic order matches
    // the user's intended sequence.
    entries.sort((a, b) => a.file.localeCompare(b.file));

    // Write manifest
    const csv = serializeManifest(entries);
    await this.fs.writeFile(manifestPath, csv);

    return { discovered, total: entries.length };
  }
}
