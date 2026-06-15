import fc from 'fast-check';
import { shouldFitOnSamePage, SEPARATOR_OVERHEAD, formatContinuationHeader } from './pdfkit-adapter.js';

/**
 * Feature: pdf-export-improvements, Property 7: Multi-per-page fit decision
 *
 * **Validates: Requirements 8.1, 8.2**
 *
 * For any remaining page space value R and estimated next-recipe height H,
 * the layout decision SHALL render the next recipe on the same page if and only if
 * R >= H + 24.5 (separator overhead: 12pt above + 0.5pt rule + 12pt below).
 * Otherwise, it SHALL start a new page.
 */
describe('Property 7: Multi-per-page fit decision', () => {
  it('shouldFitOnSamePage(R, H) returns true iff R >= H + SEPARATOR_OVERHEAD', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 2000, noNaN: true }),
        fc.float({ min: 0, max: 2000, noNaN: true }),
        (R, H) => {
          const result = shouldFitOnSamePage(R, H);
          const expected = R >= H + SEPARATOR_OVERHEAD;
          return result === expected;
        },
      ),
    );
  });

  it('boundary: R = H + 24.5 exactly → fits on same page', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1975, noNaN: true }),
        (H) => {
          const R = H + 24.5;
          return shouldFitOnSamePage(R, H) === true;
        },
      ),
    );
  });

  it('boundary: R = H + 24.4999 → does not fit on same page', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1975, noNaN: true }),
        (H) => {
          const R = H + 24.4999;
          return shouldFitOnSamePage(R, H) === false;
        },
      ),
    );
  });

  it('monotonically increasing in R: more space → more likely to fit', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1999, noNaN: true }),
        fc.float({ min: 0, max: 2000, noNaN: true }),
        fc.float({ min: Math.fround(0.001), max: 1000, noNaN: true }),
        (R, H, delta) => {
          // If it fits at R, it must also fit at R + delta (more space)
          if (shouldFitOnSamePage(R, H)) {
            return shouldFitOnSamePage(R + delta, H) === true;
          }
          return true;
        },
      ),
    );
  });

  it('monotonically decreasing in H: taller recipe → less likely to fit', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 2000, noNaN: true }),
        fc.float({ min: 0, max: 1999, noNaN: true }),
        fc.float({ min: Math.fround(0.001), max: 1000, noNaN: true }),
        (R, H, delta) => {
          // If it does NOT fit at H, it must also NOT fit at H + delta (taller)
          if (!shouldFitOnSamePage(R, H)) {
            return shouldFitOnSamePage(R, H + delta) === false;
          }
          return true;
        },
      ),
    );
  });
});

/**
 * Feature: pdf-export-improvements, Property 9: Continuation header format
 *
 * **Validates: Requirements 9.2**
 *
 * For any recipe title string, when a recipe overflows to an additional page,
 * the continuation header SHALL be exactly "[title], continued" where [title]
 * is the full recipe title.
 */
describe('Property 9: Continuation header format', () => {
  it('formatContinuationHeader(title) equals `${title}, continued`', () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        return formatContinuationHeader(title) === `${title}, continued`;
      }),
    );
  });

  it('result always ends with ", continued"', () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        return formatContinuationHeader(title).endsWith(', continued');
      }),
    );
  });

  it('result always starts with the original title', () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        return formatContinuationHeader(title).startsWith(title);
      }),
    );
  });

  it('result length is always title.length + 11', () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        return formatContinuationHeader(title).length === title.length + 11;
      }),
    );
  });

  it('empty string produces ", continued"', () => {
    expect(formatContinuationHeader('')).toBe(', continued');
  });
});
