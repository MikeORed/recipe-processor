import type { CommandHandler } from './types.js';

export function createStubHandler(commandName: string): CommandHandler {
  return async (_args: string[]) => {
    console.log(`${commandName} is not implemented yet`);
  };
}
