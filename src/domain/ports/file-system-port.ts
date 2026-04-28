export interface FileSystemPort {
  createDirectory(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getFileModifiedTime(path: string): Promise<Date>;
  listDirectory(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
