import type { RustWasmBash, RustWasmBashOptions, RustWasmFileSystem, WasmFileSystem } from "./index.js";
export type * from "./index.js";
export { ShellLimitError, WasmFileSystem } from "./index.js";
export function createRustWasmBash<F extends RustWasmFileSystem = WasmFileSystem>(options?: RustWasmBashOptions<F>): Promise<RustWasmBash<F>>;
