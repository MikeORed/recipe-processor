import { runCli, printHelp } from './cli.js';

const KNOWN_COMMANDS = ['init', 'ingest', 'transcribe', 'export', 'jobs', 'use'] as const;
const STUB_COMMANDS = ['export'] as const;

// Mock the real handler modules so CLI routing tests stay isolated from
// filesystem-dependent implementations. Stubs are left unmocked.
jest.mock('./init-handler.js', () => ({
  initHandler: jest.fn(async () => {
    console.log('init handler called');
  }),
}));
jest.mock('./ingest-handler.js', () => ({
  ingestHandler: jest.fn(async () => {
    console.log('ingest handler called');
  }),
}));
jest.mock('./jobs-handler.js', () => ({
  jobsHandler: jest.fn(async () => {
    console.log('jobs handler called');
  }),
}));
jest.mock('./use-handler.js', () => ({
  useHandler: jest.fn(async () => {
    console.log('use handler called');
  }),
}));
jest.mock('./transcribe-handler.js', () => ({
  transcribeHandler: jest.fn(async () => {
    console.log('transcribe handler called');
  }),
}));

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
      '"%s" routes to its handler without error',
      async (command) => {
        await runCli([command]);

        expect(stdoutSpy).toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
      },
    );

    it.each(STUB_COMMANDS)(
      '"%s" prints stub message',
      async (command) => {
        await runCli([command]);

        expect(stdoutSpy).toHaveBeenCalledWith(
          `${command} is not implemented yet`,
        );
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
      // Import the mocked handler and make it throw
      const { initHandler } = await import('./init-handler.js');
      (initHandler as jest.Mock).mockRejectedValueOnce(
        new Error('handler failure'),
      );

      await runCli(['init']);

      expect(stderrSpy).toHaveBeenCalledWith('handler failure');
      expect(process.exitCode).toBe(1);
    });
  });
});
