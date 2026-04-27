import { jobsHandler } from './jobs-handler.js';

describe('jobsHandler', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints "jobs is not implemented yet" to stdout', async () => {
    await jobsHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith('jobs is not implemented yet');
  });
});
