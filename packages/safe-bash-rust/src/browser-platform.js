import { adapterBytes } from "./stream-adapter.js";
export { fsOperationError, posix } from "./portable-platform.js";

let compiled, adapter;
export async function instantiateCore(imports) {
  compiled ??= WebAssembly.compileStreaming(fetch(new URL("./safe_bash_rust.wasm", import.meta.url))).catch(error => {
    compiled = undefined;
    throw error;
  });
  return WebAssembly.instantiate(await compiled, imports);
}
export function callbackModule() { return adapter ??= new WebAssembly.Module(adapterBytes); }
