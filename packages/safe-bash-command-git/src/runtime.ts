let module: object | undefined;
const wasm = (globalThis as unknown as { WebAssembly: { Module: new (bytes: ArrayBuffer | Uint8Array) => object } }).WebAssembly;
export function gitModule(): object {
  if (module) return module;
  const proc = (globalThis as unknown as {
    process?: {
      getBuiltinModule?: (id: string) => Record<string, unknown> | undefined;
    };
  }).process;
  const nodeFs = proc?.getBuiltinModule?.("node:fs") as { readFileSync(url: URL): Uint8Array } | undefined;
  if (nodeFs) {
    try {
      return (module = new wasm.Module(nodeFs.readFileSync(new URL("./git_rust.wasm", import.meta.url))));
    } catch {
      // Bundled installations can supply the generated WASM fallback below.
    }
  }
  const nodeModule = proc?.getBuiltinModule?.("node:module") as { createRequire(url: string): (id: string) => { wasmBytes(): Uint8Array } } | undefined;
  if (nodeModule) {
    const { wasmBytes } = nodeModule.createRequire(import.meta.url)("./wasm.generated.js");
    return (module = new wasm.Module(wasmBytes().buffer as ArrayBuffer));
  }
  throw new Error("Git WASM module unavailable");
}
