export class HeirloomError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = this.constructor.name;
  }
}
