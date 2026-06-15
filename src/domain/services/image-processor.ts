import sharp from 'sharp';
import path from 'node:path';
import os from 'node:os';
import { mkdir, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/**
 * Metadata for a pre-processed (downsampled) image ready for PDF embedding.
 */
export interface ProcessedImage {
  originalKey: string;
  localPath: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Resolves an imageKey to a local file path within the job's images directory.
 *
 * ImageKey format: "<jobName>/<filename>"
 * Resolved path: "jobs/<jobName>/images/<filename>"
 *
 * Extracts the filename portion after the first `/` separator.
 */
export function resolveImageKeyPath(imageKey: string, jobName: string): string {
  const separatorIndex = imageKey.indexOf('/');
  const filename = separatorIndex >= 0
    ? imageKey.substring(separatorIndex + 1)
    : imageKey;

  return path.join('jobs', jobName, 'images', filename);
}

/**
 * Pre-processes images by downsampling them to the target width and DPI.
 *
 * For each imageKey:
 * 1. Resolves the key to a local file path
 * 2. Resizes to the target width (preserving aspect ratio) at 150 DPI
 * 3. Writes the result to a temp directory as JPEG
 * 4. Returns metadata for the adapter to embed
 *
 * Missing files are skipped with a console warning.
 */
export async function preprocessImages(
  imageKeys: string[],
  jobName: string,
  targetWidthPx: number,
  targetDpi: number,
): Promise<ProcessedImage[]> {
  const results: ProcessedImage[] = [];

  // Create a unique temp directory for this batch
  const tempDir = path.join(os.tmpdir(), `heirloom-images-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  for (const imageKey of imageKeys) {
    const sourcePath = resolveImageKeyPath(imageKey, jobName);

    // Check if the source file exists
    try {
      await access(sourcePath);
    } catch {
      console.warn(
        `[image-processor] Source image not found, skipping: ${sourcePath}`,
      );
      continue;
    }

    try {
      // Determine the output filename
      const basename = path.basename(sourcePath, path.extname(sourcePath));
      const outputFilename = `${basename}-${targetWidthPx}w.jpg`;
      const outputPath = path.join(tempDir, outputFilename);

      // Resize to target width, preserving aspect ratio, and set DPI metadata
      const result = await sharp(sourcePath)
        .resize({ width: targetWidthPx })
        .jpeg({ quality: targetWidthPx <= 300 ? 75 : 85 })
        .withMetadata({ density: targetDpi })
        .toFile(outputPath);

      results.push({
        originalKey: imageKey,
        localPath: outputPath,
        widthPx: result.width,
        heightPx: result.height,
      });
    } catch (error) {
      console.warn(
        `[image-processor] Failed to process image "${imageKey}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return results;
}
