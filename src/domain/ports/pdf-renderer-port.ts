import type { Recipe } from '../models/index.js';

export type ImageMode = 'none' | 'thumbnail' | 'full';
export type PageSize = 'letter' | 'a4';

export interface PdfRenderOptions {
  imageMode: ImageMode;
  pageSize: PageSize;
  multiPerPage: boolean;
  confidenceMarkers: boolean;
  chapterGrouping: boolean;
  /**
   * Map of imageKey → local file path for pre-processed (downsampled) images.
   * When present, the renderer uses these paths instead of resolving originals.
   * Populated by ExportService during the image pre-processing phase.
   */
  processedImageMap?: Map<string, string>;
}

export interface ChapterGroup {
  chapter: string;
  recipes: Recipe[];
}

export interface PdfRendererPort {
  render(
    chapters: ChapterGroup[],
    options: PdfRenderOptions,
    outputPath: string,
  ): Promise<void>;
}
