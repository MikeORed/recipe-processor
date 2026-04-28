import type { FileSystemPort } from '../ports/file-system-port.js';
import type { ObjectStore } from '../ports/object-store-port.js';
import type { OCRProvider } from '../ports/ocr-provider-port.js';
import type { StructureExtractor } from '../ports/structure-extractor-port.js';
import type { DataStore } from '../ports/data-store-port.js';
import type { ManifestEntry } from '../models/index.js';
import { HeirloomError } from '../../shared/errors.js';
import { parseManifest } from './csv-utils.js';

export interface TranscriptionResult {
  recipesTranscribed: number;
  entriesSkipped: number;
  elapsedMs: number;
  errors: Array<{ recipeNumber: string; error: string }>;
}

export class TranscribeService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly objectStore: ObjectStore,
    private readonly ocrProvider: OCRProvider,
    private readonly structureExtractor: StructureExtractor,
    private readonly dataStore: DataStore,
  ) {}

  /**
   * Run the transcription pipeline for a job.
   *
   * Reads the manifest CSV, filters and groups entries by recipeNumber,
   * uploads images, runs OCR, extracts structure, and persists recipes.
   */
  async transcribe(
    jobName: string,
    jobDir: string,
    onProgress?: (recipeNumber: string, index: number, total: number) => void,
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // Read and parse manifest
    const manifestPath = `${jobDir}/manifest.csv`;
    const csv = await this.fs.readFile(manifestPath);
    const entries = parseManifest(csv);

    // Filter entries with non-empty recipeNumber
    const annotated = entries.filter((e) => e.recipeNumber.trim() !== '');
    const entriesSkipped = entries.length - annotated.length;

    if (annotated.length === 0) {
      throw new HeirloomError(
        'No annotated entries found in manifest. Annotate entries with a recipe number before transcribing.',
      );
    }

    // Group entries by recipeNumber
    const groups = this.groupByRecipeNumber(annotated);

    // Update job status to transcribing
    await this.dataStore.updateJobStatus(jobName, 'transcribing');

    let recipesTranscribed = 0;
    const errors: Array<{ recipeNumber: string; error: string }> = [];
    const total = groups.size;
    let index = 0;

    for (const [recipeNumber, groupEntries] of groups) {
      index++;
      onProgress?.(recipeNumber, index, total);
      try {
        await this.processRecipeGroup(jobName, jobDir, recipeNumber, groupEntries);
        recipesTranscribed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ recipeNumber, error: message });
      }
    }

    // Update job status based on results
    if (recipesTranscribed === 0) {
      await this.dataStore.updateJobStatus(jobName, 'ingested');
    } else {
      await this.dataStore.updateJobStatus(jobName, 'transcribed');
    }

    return {
      recipesTranscribed,
      entriesSkipped,
      elapsedMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Group manifest entries by their recipeNumber field.
   */
  groupByRecipeNumber(entries: ManifestEntry[]): Map<string, ManifestEntry[]> {
    const groups = new Map<string, ManifestEntry[]>();
    for (const entry of entries) {
      const key = entry.recipeNumber;
      const group = groups.get(key);
      if (group) {
        group.push(entry);
      } else {
        groups.set(key, [entry]);
      }
    }
    return groups;
  }

  /**
   * Build the S3 object key for an image file.
   */
  buildUploadKey(jobName: string, filename: string): string {
    return `${jobName}/${filename}`;
  }

  /**
   * Process a single recipe group: upload images, run OCR, extract structure, persist.
   */
  private async processRecipeGroup(
    jobName: string,
    jobDir: string,
    recipeNumber: string,
    entries: ManifestEntry[],
  ): Promise<void> {
    const imageKeys: string[] = [];
    const ocrTexts: string[] = [];

    for (const entry of entries) {
      const localPath = `${jobDir}/images/${entry.file}`;
      const key = this.buildUploadKey(jobName, entry.file);

      // Check if file exists locally
      if (!(await this.fs.exists(localPath))) {
        // Skip missing files — log and continue
        continue;
      }

      // Idempotent upload: skip if already exists in object store
      const alreadyUploaded = await this.objectStore.exists(key);
      if (!alreadyUploaded) {
        await this.objectStore.upload(localPath, key);
      }

      imageKeys.push(key);

      // Run OCR on the uploaded image
      try {
        const ocrResult = await this.ocrProvider.extractText(key);
        const text = ocrResult.blocks.map((b) => b.text).join('\n');
        if (text.trim().length > 0) {
          ocrTexts.push(text);
        }
      } catch {
        // OCR error for this image — skip it, continue with remaining images
        continue;
      }
    }

    // If no images were successfully uploaded, skip this group
    if (imageKeys.length === 0) {
      throw new HeirloomError(`No images could be processed for recipe ${recipeNumber}`);
    }

    // Combine OCR text from all images in the group
    const combinedText = ocrTexts.join('\n\n');

    if (combinedText.trim().length === 0) {
      throw new HeirloomError(`No OCR text extracted for recipe ${recipeNumber}`);
    }

    // Determine source from the first entry (all entries in a group share the same recipeNumber)
    const source = entries[0].source ?? '';

    // Extract structured recipe data
    const recipe = await this.structureExtractor.extract({
      ocrText: combinedText,
      recipeNumber,
      source,
      jobName,
      imageKeys,
    });

    // Persist the recipe
    await this.dataStore.putRecipe(recipe);
  }
}
