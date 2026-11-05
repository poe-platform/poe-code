import core from "./safe_bash_rust.wasm";
import adapter from "./stream-adapter.wasm";
export { fsOperationError, posix } from "./portable-platform.js";
export function instantiateCore(imports) { return new WebAssembly.Instance(core, imports); }
export function callbackModule() { return adapter; }
