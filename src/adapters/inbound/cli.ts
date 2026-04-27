import { initHandler } from './init-handler.js';
import { ingestHandler } from './ingest-handler.js';
import { transcribeHandler } from './transcribe-handler.js';
import { exportHandler } from './export-handler.js';
import { jobsHandler } from './jobs-handler.js';
import { useHandler } from './use-handler.js';
import type { CommandHandler } from './types.js';

export type { CommandHandler } from './types.js';

const commands: Map<string, CommandHandler> = new Map();

commands.set('init', initHandler);
commands.set('ingest', ingestHandler);
commands.set('transcribe', transcribeHandler);
commands.set('export', exportHandler);
commands.set('jobs', jobsHandler);
commands.set('use', useHandler);

export function printHelp(): void {
  console.log('Usage: heirloom <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  init         Create a new job workspace');
  console.log('  ingest       Scan images and generate manifest');
  console.log('  transcribe   OCR and structure extraction');
  console.log('  export       Generate output (PDF, Obsidian, etc.)');
  console.log('  jobs         List and manage jobs');
  console.log('  use          Select a job to work with');
}

export async function runCli(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  if (!command) {
    printHelp();
    return;
  }

  const handler = commands.get(command);

  if (!handler) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    await handler(args);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
