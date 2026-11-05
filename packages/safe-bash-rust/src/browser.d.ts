import type { RustWasmBash, RustWasmBashOptions } from "./index.js";
export type * from "./index.js";
export { ShellLimitError, WasmFileSystem } from "./index.js";
export function createRustWasmBash(options?: RustWasmBashOptions): Promise<RustWasmBash>;
