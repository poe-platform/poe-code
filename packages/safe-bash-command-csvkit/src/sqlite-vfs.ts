/** Synchronous trusted random-access capability. No ambient or async FS bridge. */
export interface SQLiteFile {
  read(target: Uint8Array, offset: number): number;
  write(source: Uint8Array, offset: number): void;
  truncate(size: number): void;
  size(): number;
  sync(): void;
  /** SQLite lock levels 0 NONE, 1 SHARED, 2 RESERVED, 3 PENDING, 4 EXCLUSIVE. */
  lock(level: number): boolean;
  unlock(level: number): void;
  reserved(): boolean;
  close(): void;
}
export interface SQLiteFileSystem {
  /** Enforce authorization for main database AND derived journal/temp paths. */
  open(path: string, flags: number): SQLiteFile;
  exists(path: string): boolean;
  delete(path: string, syncDirectory: boolean): void;
}
