let module: object | undefined;
const wasm = (globalThis as unknown as { WebAssembly: { Module: new (bytes: ArrayBuffer | Uint8Array) => object } }).WebAssembly;
function detachBytesBuffer(bytes: Uint8Array): void {
  const buf = bytes.buffer as ArrayBuffer & { transfer?: (newByteLength?: number) => ArrayBuffer };
  if (typeof buf.transfer === "function" && bytes.byteOffset === 0 && bytes.byteLength === buf.byteLength) {
    try {
      buf.transfer(0);
    } catch {
      // Buffer may be non-detachable.
    }
  }
}
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
      const raw = nodeFs.readFileSync(new URL("./git_rust.wasm", import.meta.url));
      module = new wasm.Module(raw);
      detachBytesBuffer(raw);
      return module;
    } catch {
      // Bundled installations can supply the generated WASM fallback below.
    }
  }
  const nodeModule = proc?.getBuiltinModule?.("node:module") as { createRequire(url: string): (id: string) => { wasmBytes(): Uint8Array } } | undefined;
  if (nodeModule) {
    const { wasmBytes } = nodeModule.createRequire(import.meta.url)("./wasm.generated.js");
    const raw = wasmBytes();
    module = new wasm.Module(raw.buffer as ArrayBuffer);
    detachBytesBuffer(raw);
    return module;
  }
  throw new Error("Git WASM module unavailable");
}
