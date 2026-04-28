import { mkdir, access, readdir, readFile, stat, writeFile } from 'node:fs/promises';

import type { FileSystemPort } from '../../domain/ports/file-system-port.js';

export class NodeFileSystemAdapter implements FileSystemPort {
  async createDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async getFileModifiedTime(path: string): Promise<Date> {
    const result = await stat(path);
    return result.mtime;
  }

  async listDirectory(path: string): Promise<string[]> {
    return readdir(path);
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content);
  }
}
