import { initHandler } from './init-handler.js';

describe('initHandler', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints "init is not implemented yet" to stdout', async () => {
    await initHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith('init is not implemented yet');
  });
});
