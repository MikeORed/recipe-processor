import { useHandler } from './use-handler.js';

describe('useHandler', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints "use is not implemented yet" to stdout', async () => {
    await useHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith('use is not implemented yet');
  });
});
