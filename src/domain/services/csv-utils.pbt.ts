import fc from 'fast-check';
import { serializeManifest, parseManifest } from './csv-utils.js';
import type { ManifestEntry } from '../models/index.js';

// Feature: cli-commands-implementation, Property 9: CSV serialization round-trip

/**
 * Arbitrary that produces valid ISO 8601 timestamps for the `modified` field.
 * Generates dates between 2000 and 2030 and formats them as ISO strings.
 */
const isoTimestampArb = fc
  .date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/**
 * Arbitrary for the `file` field: non-empty string that does NOT contain
 * newlines, carriage returns, commas, or double quotes (these are filenames).
 * Uses printable ASCII characters excluding the forbidden ones.
 */
const fileFieldArb = fc
  .stringMatching(/^[A-Za-z0-9._\-/ ]{1,80}$/)
  .filter((s) => s.length >= 1);

/**
 * Arbitrary for `source` and `recipeNumber` fields: can contain arbitrary text
 * including commas, quotes, and newlines — the CSV quoting must handle these.
 */
const freeTextArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 0, maxLength: 100 }),
  // Explicitly include strings with special CSV characters
  fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.constantFrom(',', '"', '\n', '\r\n', '","', 'hello,world', 'say "hi"', 'line1\nline2'),
      fc.string({ minLength: 0, maxLength: 30 }),
    )
    .map(([a, special, b]) => a + special + b),
);

/** Arbitrary that produces valid ManifestEntry objects. */
const manifestEntryArb: fc.Arbitrary<ManifestEntry> = fc.record({
  file: fileFieldArb,
  modified: isoTimestampArb,
  recipeNumber: freeTextArb,
  source: freeTextArb,
});

describe('CSV serialization round-trip (property-based)', () => {
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  it('parseManifest(serializeManifest(entries)) deeply equals the original input', () => {
    fc.assert(
      fc.property(
        fc.array(manifestEntryArb, { minLength: 0, maxLength: 20 }),
        (entries) => {
          const csv = serializeManifest(entries);
          const parsed = parseManifest(csv);

          expect(parsed).toEqual(entries);
        },
      ),
      { numRuns: 100 },
    );
  });
});
