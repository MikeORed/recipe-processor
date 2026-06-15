import fc from 'fast-check';
import {
  shouldFitOnSamePage,
  SEPARATOR_OVERHEAD,
  formatContinuationHeader,
  computeDisplayedPageNumber,
  shouldStampHeader,
  shouldStampFooter,
  type PageType,
} from './pdfkit-adapter.js';

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


/**
 * Feature: pdf-export-improvements, Property 10: TOC page number offset
 *
 * **Validates: Requirements 5.3, 5.4**
 *
 * For any rendered PDF where the TOC occupies N pages, every page number
 * displayed in the TOC for a recipe SHALL equal that recipe's position in
 * the body document plus N (the TOC page count offset).
 *
 * Formula: displayedPageNumber = bodyPageIndex + tocPageCount + 1
 * Where bodyPageIndex is 0-based and displayedPageNumber is 1-based.
 */
describe('Property 10: TOC page number offset', () => {
  it('computeDisplayedPageNumber(bodyPageIndex, tocPageCount) === bodyPageIndex + tocPageCount + 1', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 500 }),  // bodyPageIndex: non-negative integer
        fc.integer({ min: 1, max: 100 }),  // tocPageCount: positive integer (at least 1 TOC page)
        (bodyPageIndex, tocPageCount) => {
          const result = computeDisplayedPageNumber(bodyPageIndex, tocPageCount);
          return result === bodyPageIndex + tocPageCount + 1;
        },
      ),
    );
  });

  it('displayed page number is always greater than tocPageCount', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 500 }),
        fc.integer({ min: 1, max: 100 }),
        (bodyPageIndex, tocPageCount) => {
          const result = computeDisplayedPageNumber(bodyPageIndex, tocPageCount);
          return result >= tocPageCount + 1;
        },
      ),
    );
  });

  it('formula is monotonically increasing in bodyPageIndex (later recipes get higher page numbers)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 499 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 500 }),
        (bodyPageIndex, tocPageCount, delta) => {
          const earlier = computeDisplayedPageNumber(bodyPageIndex, tocPageCount);
          const later = computeDisplayedPageNumber(bodyPageIndex + delta, tocPageCount);
          return later > earlier;
        },
      ),
    );
  });

  it('first body page (index 0) always gets displayed page number tocPageCount + 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (tocPageCount) => {
          return computeDisplayedPageNumber(0, tocPageCount) === tocPageCount + 1;
        },
      ),
    );
  });

  it('consecutive body pages have consecutive displayed page numbers', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 499 }),
        fc.integer({ min: 1, max: 100 }),
        (bodyPageIndex, tocPageCount) => {
          const current = computeDisplayedPageNumber(bodyPageIndex, tocPageCount);
          const next = computeDisplayedPageNumber(bodyPageIndex + 1, tocPageCount);
          return next === current + 1;
        },
      ),
    );
  });
});

/**
 * Feature: pdf-export-improvements, Property 12: Header and footer page-type invariant
 *
 * **Validates: Requirements 10.4, 12.1, 12.2**
 *
 * For any page in the rendered PDF, page headers (chapter name + recipe title)
 * and page number footers SHALL appear if and only if the page is a recipe content page.
 * TOC pages and Chapter_Divider pages SHALL have no headers or footers.
 */
describe('Property 12: Header and footer page-type invariant', () => {
  /** Arbitrary generator for valid page types */
  const pageTypeArb = fc.constantFrom<PageType>('recipe', 'divider', 'appendix');

  it('shouldStampHeader returns true only for recipe pages', () => {
    fc.assert(
      fc.property(pageTypeArb, (type) => {
        const result = shouldStampHeader(type);
        if (type === 'recipe') {
          return result === true;
        }
        return result === false;
      }),
    );
  });

  it('shouldStampFooter returns true only for recipe and appendix pages', () => {
    fc.assert(
      fc.property(pageTypeArb, (type) => {
        const result = shouldStampFooter(type);
        if (type === 'recipe' || type === 'appendix') {
          return result === true;
        }
        return result === false;
      }),
    );
  });

  it('divider pages receive neither header nor footer', () => {
    fc.assert(
      fc.property(fc.constant('divider' as PageType), (type) => {
        return shouldStampHeader(type) === false && shouldStampFooter(type) === false;
      }),
    );
  });

  it('for any array of PageOwnership entries, header count equals recipe-type count', () => {
    const pageOwnershipArb = fc.array(
      fc.record({
        pageIndex: fc.nat({ max: 500 }),
        chapter: fc.string({ minLength: 1, maxLength: 50 }),
        recipeTitle: fc.string({ minLength: 1, maxLength: 100 }),
        type: pageTypeArb,
      }),
      { minLength: 0, maxLength: 50 },
    );

    fc.assert(
      fc.property(pageOwnershipArb, (entries) => {
        const headerCount = entries.filter((e) => shouldStampHeader(e.type)).length;
        const expectedHeaderCount = entries.filter((e) => e.type === 'recipe').length;
        return headerCount === expectedHeaderCount;
      }),
    );
  });

  it('for any array of PageOwnership entries, footer count equals recipe + appendix count', () => {
    const pageOwnershipArb = fc.array(
      fc.record({
        pageIndex: fc.nat({ max: 500 }),
        chapter: fc.string({ minLength: 1, maxLength: 50 }),
        recipeTitle: fc.string({ minLength: 1, maxLength: 100 }),
        type: pageTypeArb,
      }),
      { minLength: 0, maxLength: 50 },
    );

    fc.assert(
      fc.property(pageOwnershipArb, (entries) => {
        const footerCount = entries.filter((e) => shouldStampFooter(e.type)).length;
        const expectedFooterCount = entries.filter(
          (e) => e.type === 'recipe' || e.type === 'appendix',
        ).length;
        return footerCount === expectedFooterCount;
      }),
    );
  });

  it('TOC pages (not in pageOwnership) implicitly receive no stamps', () => {
    // TOC pages are never represented in pageOwnership, so they never
    // pass through the stamping logic. This test verifies that the
    // decision functions only operate on explicit PageType values —
    // there is no page type that accidentally stamps.
    fc.assert(
      fc.property(pageTypeArb, (type) => {
        // For every valid page type, the decision is deterministic
        const header = shouldStampHeader(type);
        const footer = shouldStampFooter(type);

        // Only recipe gets header
        if (header) return type === 'recipe';
        // Only recipe and appendix get footer
        if (footer) return type === 'recipe' || type === 'appendix';
        // Divider gets nothing
        return type === 'divider';
      }),
    );
  });
});
