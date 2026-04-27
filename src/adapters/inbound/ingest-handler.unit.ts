import { ingestHandler } from './ingest-handler.js';

describe('ingestHandler', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints "ingest is not implemented yet" to stdout', async () => {
    await ingestHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith('ingest is not implemented yet');
  });
});
