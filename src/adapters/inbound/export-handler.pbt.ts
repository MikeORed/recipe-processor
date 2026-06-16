// Mock heavy adapter dependencies to avoid ESM transform issues in Jest
jest.mock('../outbound/dynamodb-adapter.js', () => ({
  DynamoDBAdapter: jest.fn(),
}));
jest.mock('../outbound/pdfkit-adapter.js', () => ({
  PdfKitAdapter: jest.fn(),
}));
jest.mock('../outbound/obsidian-vault-adapter.js', () => ({
  ObsidianVaultAdapter: jest.fn(),
}));
jest.mock('../outbound/node-file-system-adapter.js', () => ({
  NodeFileSystemAdapter: jest.fn(),
}));
jest.mock('../../domain/services/job-service.js', () => ({
  JobService: jest.fn(),
}));
jest.mock('../../domain/services/export-service.js', () => ({
  ExportService: jest.fn(),
}));

import fc from 'fast-check';
import { parseExportOptions } from './export-handler.js';
import type { ImageMode, PageSize } from '../../domain/ports/pdf-renderer-port.js';

// --- Constants ---

const VALID_IMAGE_MODES: ImageMode[] = ['none', 'thumbnail', 'full'];
const VALID_PAGE_SIZES: PageSize[] = ['letter', 'a4'];

// --- Arbitraries ---

/** Arbitrary that produces a valid --images value or undefined (absent). */
const imageModeArb = fc.oneof(
  fc.constantFrom<ImageMode>('none', 'thumbnail', 'full'),
  fc.constant(undefined as ImageMode | undefined),
);

/** Arbitrary that produces a valid --page-size value or undefined (absent). */
const pageSizeArb = fc.oneof(
  fc.constantFrom<PageSize>('letter', 'a4'),
  fc.constant(undefined as PageSize | undefined),
);

/** Arbitrary that produces a boolean flag value or undefined (absent). */
const boolFlagArb = fc.oneof(
  fc.boolean(),
  fc.constant(undefined as boolean | undefined),
);

/** Arbitrary that produces a boolean for --no-chapters presence or undefined (absent). */
const noChaptersArb = fc.oneof(
  fc.constant(true),
  fc.constant(undefined as boolean | undefined),
);

/** Arbitrary for a full valid CLI options combination. */
const validOptionsArb = fc.record({
  imageMode: imageModeArb,
  pageSize: pageSizeArb,
  multiPerPage: boolFlagArb,
  confidence: boolFlagArb,
  noChapters: noChaptersArb,
});

/**
 * Builds a CLI args array from generated option values.
 * Starts with 'pdf' as the format argument (required by the handler context).
 */
function buildArgs(opts: {
  imageMode?: ImageMode;
  pageSize?: PageSize;
  multiPerPage?: boolean;
  confidence?: boolean;
  noChapters?: boolean;
}): string[] {
  const args: string[] = ['pdf'];

  if (opts.imageMode !== undefined) {
    args.push('--images', opts.imageMode);
  }
  if (opts.pageSize !== undefined) {
    args.push('--page-size', opts.pageSize);
  }
  if (opts.multiPerPage !== undefined) {
    args.push('--multi-per-page', String(opts.multiPerPage));
  }
  if (opts.confidence !== undefined) {
    args.push('--confidence', String(opts.confidence));
  }
  if (opts.noChapters === true) {
    args.push('--no-chapters');
  }

  return args;
}

/**
 * Arbitrary that produces a string NOT in the valid image modes list.
 * Filters out empty strings and the valid values.
 */
const invalidImageModeArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !VALID_IMAGE_MODES.includes(s as ImageMode));

/**
 * Arbitrary that produces a string NOT in the valid page sizes list.
 * Filters out empty strings and the valid values.
 */
const invalidPageSizeArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !VALID_PAGE_SIZES.includes(s as PageSize));

// --- Property 13: CLI option parsing with defaults and rejection ---

describe('Feature: pdf-export-improvements, Property 13: CLI option parsing', () => {
  describe('Property 13a: Valid flag combinations produce correct PdfRenderOptions', () => {
    it('produces correct option mappings with defaults for omitted flags', () => {
      /**
       * Validates: Requirements 14.1, 14.2
       */
      fc.assert(
        fc.property(validOptionsArb, (opts) => {
          const args = buildArgs(opts);
          const result = parseExportOptions(args);

          expect(result).not.toBeNull();

          // Verify correct mappings with defaults for omitted flags
          expect(result!.imageMode).toBe(opts.imageMode ?? 'thumbnail');
          expect(result!.pageSize).toBe(opts.pageSize ?? 'letter');

          // --multi-per-page: "false" → false, anything else (including "true") → true
          if (opts.multiPerPage === false) {
            expect(result!.multiPerPage).toBe(false);
          } else {
            expect(result!.multiPerPage).toBe(true);
          }

          // --confidence: "false" → false, anything else (including "true") → true
          if (opts.confidence === false) {
            expect(result!.confidenceMarkers).toBe(false);
          } else {
            expect(result!.confidenceMarkers).toBe(true);
          }

          // --no-chapters presence means chapterGrouping = false
          if (opts.noChapters === true) {
            expect(result!.chapterGrouping).toBe(false);
          } else {
            expect(result!.chapterGrouping).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 13b: Invalid --images values produce null', () => {
    let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('rejects any --images value not in the valid set', () => {
      /**
       * Validates: Requirements 15.3, 15.5
       */
      fc.assert(
        fc.property(invalidImageModeArb, (invalidValue) => {
          consoleErrorSpy.mockClear();
          const args = ['pdf', '--images', invalidValue];
          const result = parseExportOptions(args);

          expect(result).toBeNull();
          expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('--images'),
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 13c: Invalid --page-size values produce null', () => {
    let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('rejects any --page-size value not in the valid set', () => {
      /**
       * Validates: Requirements 15.3, 15.5
       */
      fc.assert(
        fc.property(invalidPageSizeArb, (invalidValue) => {
          consoleErrorSpy.mockClear();
          const args = ['pdf', '--page-size', invalidValue];
          const result = parseExportOptions(args);

          expect(result).toBeNull();
          expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('--page-size'),
          );
        }),
        { numRuns: 100 },
      );
    });
  });
});
