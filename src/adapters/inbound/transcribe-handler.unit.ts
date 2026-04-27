import { transcribeHandler } from './transcribe-handler.js';

describe('transcribeHandler', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('prints "transcribe is not implemented yet" to stdout', async () => {
    await transcribeHandler([]);

    expect(stdoutSpy).toHaveBeenCalledWith('transcribe is not implemented yet');
  });
});
