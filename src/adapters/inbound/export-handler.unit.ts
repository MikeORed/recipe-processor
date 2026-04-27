import { exportHandler } from './export-handler.js';

describe('exportHandler', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints "export is not implemented yet" to stdout', async () => {
    await exportHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith('export is not implemented yet');
  });
});
