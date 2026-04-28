import fc from 'fast-check';
import { jobNameSchema } from './job.js';

// Feature: cli-commands-implementation, Property 1: Job name validation is consistent with the pattern

const JOB_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function isValidJobName(s: string): boolean {
  return s.length >= 1 && s.length <= 128 && JOB_NAME_PATTERN.test(s);
}

/** Arbitrary that produces valid job-name first characters. */
const firstCharArb = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''));

/** Arbitrary that produces valid job-name tail characters. */
const tailCharArb = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split(''));

/** Arbitrary that produces valid job names (1–128 chars). */
const validJobNameArb = fc
  .tuple(
    firstCharArb,
    fc.array(tailCharArb, { minLength: 0, maxLength: 127 }),
  )
  .map(([first, rest]) => first + rest.join(''))
  .filter((s) => s.length <= 128);

describe('jobNameSchema (property-based)', () => {
  it('accepts a string iff it matches the pattern and length 1–128', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = jobNameSchema.safeParse(s);
        const expected = isValidJobName(s);

        expect(result.success).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('always accepts strings generated from the valid job name alphabet', () => {
    fc.assert(
      fc.property(validJobNameArb, (name) => {
        const result = jobNameSchema.safeParse(name);
        expect(result.success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('always rejects strings that violate the pattern', () => {
    const invalidStart = fc
      .tuple(
        fc.constantFrom('-', '_', ' ', '!', 'A', 'Z'),
        fc.string({ minLength: 0, maxLength: 50 }),
      )
      .map(([first, rest]) => first + rest);

    fc.assert(
      fc.property(invalidStart, (name) => {
        const result = jobNameSchema.safeParse(name);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('always rejects strings exceeding 128 characters', () => {
    const longString = fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 129, maxLength: 256 })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(longString, (name) => {
        const result = jobNameSchema.safeParse(name);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
