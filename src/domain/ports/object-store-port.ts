export interface ObjectStore {
  upload(localPath: string, key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
