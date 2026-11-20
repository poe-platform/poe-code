import path from "node:path";
import type { BuildResult } from "esbuild";

// Keep copied WASM assets as precompiled Workerd modules, including in fixtures
// whose current operation only uses the JavaScript portion of a package.
export function workerdBundle(bundle: BuildResult, script: string) {
  const entry = bundle.outputFiles!.find(file => file.path.endsWith("/stdin.js"))!;
  return {
    modulesRoot: path.dirname(entry.path),
    modules: [
      { type: "ESModule" as const, path: path.join(path.dirname(entry.path), "worker.mjs"),
        contents: `import * as api from "./stdin.js";\n${script}` },
      ...bundle.outputFiles!.map(file => file.path.endsWith(".wasm")
        ? { type: "CompiledWasm" as const, path: file.path, contents: file.contents }
        : { type: "ESModule" as const, path: file.path, contents: file.text }),
    ],
  };
}
