import { readFile } from "node:fs/promises";
import type { Plugin } from "esbuild";

// Node VMs receive real host-compiled modules just as Workerd receives WASM
// modules from its deployment loader. No runtime compilation is required.
export function wasmVmFixture() {
  const wasmModules: WebAssembly.Module[] = [];
  const plugin: Plugin = {
    name: "precompiled-vm-wasm",
    setup(builder) {
      builder.onLoad({ filter: /\.wasm$/ }, async args => {
        const module = await WebAssembly.compile(await readFile(args.path));
        // Compilation can overlap for multiple assets.
        const slot = wasmModules.push(module) - 1;
        return { contents: `export default wasmModules[${slot}];`, loader: "js" };
      });
    },
  };
  return { wasmModules, plugin };
}
