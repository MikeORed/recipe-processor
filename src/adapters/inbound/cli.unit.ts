import { runCli, printHelp } from './cli.js';

const KNOWN_COMMANDS = ['init', 'ingest', 'transcribe', 'export', 'jobs', 'use'] as const;

describe('CLI command routing', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
    stderrSpy = jest.spyOn(console, 'error').mockImplementation();
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = savedExitCode;
  });

  describe('no-argument invocation', () => {
    it('displays help message to stdout', async () => {
      await runCli([]);

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('Usage:');
      expect(output).toContain('Commands:');
    });

    it('does not set a non-zero exit code', async () => {
      await runCli([]);

      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('unknown command', () => {
    it('prints error to stderr containing the unknown command name', async () => {
      await runCli(['frobnicate']);

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('frobnicate'),
      );
    });

    it('prints help to stdout', async () => {
      await runCli(['frobnicate']);

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });

    it('sets process.exitCode to 1', async () => {
      await runCli(['frobnicate']);

      expect(process.exitCode).toBe(1);
    });
  });

  describe('recognized commands route to their handlers', () => {
    it.each(KNOWN_COMMANDS)(
      '"%s" routes to its handler and prints stub message',
      async (command) => {
        await runCli([command]);

        expect(stdoutSpy).toHaveBeenCalledWith(
          `${command} is not implemented yet`,
        );
        expect(process.exitCode).toBeUndefined();
      },
    );
  });

  describe('printHelp', () => {
    it('lists all six commands', () => {
      printHelp();

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      for (const cmd of KNOWN_COMMANDS) {
        expect(output).toContain(cmd);
      }
    });
  });

  describe('handler error propagation', () => {
    it('catches handler errors, prints message to stderr, and sets exitCode to 1', async () => {
      // Make console.log throw to simulate a handler failure.
      // The stub handlers call console.log, so this triggers the catch path in runCli.
      stdoutSpy.mockRestore();
      stdoutSpy = jest.spyOn(console, 'log').mockImplementation(() => {
        throw new Error('handler failure');
      });

      await runCli(['init']);

      expect(stderrSpy).toHaveBeenCalledWith('handler failure');
      expect(process.exitCode).toBe(1);
    });
  });
});
