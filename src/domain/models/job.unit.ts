import {
  jobNameSchema,
  jobStatusSchema,
  jobSchema,
  manifestEntrySchema,
  SUPPORTED_IMAGE_EXTENSIONS,
} from './job.js';

describe('jobNameSchema', () => {
  it.each([
    'a',
    'my-job',
    'job123',
    '0-start-with-digit',
    'a_b_c',
    'a'.repeat(128),
  ])('accepts valid name: %s', (name) => {
    expect(jobNameSchema.safeParse(name).success).toBe(true);
  });

  it('rejects empty string', () => {
    const result = jobNameSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects string exceeding 128 characters', () => {
    const result = jobNameSchema.safeParse('a'.repeat(129));
    expect(result.success).toBe(false);
  });

  it.each([
    'MyJob',
    'ALLUPPER',
    'has Space',
  ])('rejects uppercase / spaces: %s', (name) => {
    expect(jobNameSchema.safeParse(name).success).toBe(false);
  });

  it.each([
    'hello!world',
    'job@name',
    'has.dot',
    'path/slash',
  ])('rejects special characters: %s', (name) => {
    expect(jobNameSchema.safeParse(name).success).toBe(false);
  });

  it.each([
    '-leading-hyphen',
    '_leading-underscore',
  ])('rejects leading hyphen/underscore: %s', (name) => {
    expect(jobNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('jobStatusSchema', () => {
  it.each(['empty', 'initialized', 'ingested'])('accepts valid status: %s', (status) => {
    expect(jobStatusSchema.safeParse(status).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(jobStatusSchema.safeParse('unknown').success).toBe(false);
  });
});

describe('jobSchema', () => {
  it('accepts a valid job object', () => {
    const result = jobSchema.safeParse({
      name: 'my-job',
      status: 'initialized',
      isActive: false,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: 'my-job',
      status: 'initialized',
      isActive: false,
    });
  });

  it('rejects a job with invalid name', () => {
    const result = jobSchema.safeParse({
      name: 'INVALID',
      status: 'initialized',
      isActive: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('manifestEntrySchema', () => {
  it('accepts a full entry', () => {
    const result = manifestEntrySchema.safeParse({
      file: 'IMG_0001.jpg',
      modified: '2026-04-25T10:01:00.000Z',
      recipeNumber: '1',
      source: "Mom's Card Box",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      file: 'IMG_0001.jpg',
      modified: '2026-04-25T10:01:00.000Z',
      recipeNumber: '1',
      source: "Mom's Card Box",
    });
  });

  it('applies defaults for optional annotation fields', () => {
    const result = manifestEntrySchema.safeParse({
      file: 'IMG_0001.jpg',
      modified: '2026-04-25T10:01:00.000Z',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      file: 'IMG_0001.jpg',
      modified: '2026-04-25T10:01:00.000Z',
      recipeNumber: '',
      source: '',
    });
  });

  it('rejects entry with empty file', () => {
    const result = manifestEntrySchema.safeParse({
      file: '',
      modified: '2026-04-25T10:01:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects entry without file', () => {
    const result = manifestEntrySchema.safeParse({
      modified: '2026-04-25T10:01:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects entry without modified', () => {
    const result = manifestEntrySchema.safeParse({
      file: 'IMG_0001.jpg',
    });
    expect(result.success).toBe(false);
  });

  it('rejects entry with empty modified', () => {
    const result = manifestEntrySchema.safeParse({
      file: 'IMG_0001.jpg',
      modified: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('SUPPORTED_IMAGE_EXTENSIONS', () => {
  it.each(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'])(
    'contains %s',
    (ext) => {
      expect(SUPPORTED_IMAGE_EXTENSIONS.has(ext)).toBe(true);
    },
  );

  it('has exactly 7 extensions', () => {
    expect(SUPPORTED_IMAGE_EXTENSIONS.size).toBe(7);
  });

  it.each(['.gif', '.svg', '.pdf', '.heic'])('does not contain %s', (ext) => {
    expect(SUPPORTED_IMAGE_EXTENSIONS.has(ext)).toBe(false);
  });
});
