export interface NativeSqliteModule {
  readonly HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  cwrap(name: string, result: string, arguments_: string[], options?: {async: boolean}): unknown;
  vfs_register(vfs: object, makeDefault: boolean): number;
}
export interface SqliteRuntime {
  readonly module: NativeSqliteModule;
  readonly table: WebAssembly.Table;
  readonly slot: number;
  readonly callbackModule: WebAssembly.Module;
}
