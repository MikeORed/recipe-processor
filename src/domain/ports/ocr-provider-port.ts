export interface TextBlock {
  text: string;
  confidence: number; // 0.0–1.0
}

export interface OCRResult {
  blocks: TextBlock[];
}

export interface OCRProvider {
  extractText(imageKey: string): Promise<OCRResult>;
}
