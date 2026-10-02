import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";

export async function portableRuntime(contents: string, options: { removeBuffer?: boolean; bootstrapBuffer?: boolean } = {}) {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const { resolveBrowserShellBuild } = await import(new URL("../../../../scripts/bundle-safe-bash.mjs", import.meta.url).href);
  const buildOptions = resolveBrowserShellBuild(root);
  const filesystem = path.join(root, "packages/safe-fs/src/core.ts");
  const result = await build({
    ...buildOptions, loader: { ...buildOptions.loader, ".wasm": "binary" }, external: [], entryPoints: undefined, splitting: false, format: "cjs", sourcemap: false,
    alias: { ...buildOptions.alias,
      "@poe-code/xml-ast": path.join(root, "packages/xml-ast/src/index.ts"),
      "@poe-code/safe-fs": filesystem,
      "@poe-code/safe-fs/core": filesystem,
      "@poe-code/safe-fs/runtime-core": filesystem,
      "@poe-code/safe-fs/fs/memory": filesystem,
      "@poe-code/safe-fs/xml": filesystem,
      "@poe-code/safe-fs/contracts/errors": filesystem,
      "@poe-code/safe-fs/contracts/object": filesystem,
      "poe-code/safe-fs/core": filesystem,
      "poe-code/safe-fs": filesystem,
    },
    stdin: { contents: (options.bootstrapBuffer ? 'import "./packages/safe-bash/src/portable-buffer.ts";\n' : '') + contents, resolveDir: root },
  });
  assert.deepEqual(Object.values(result.metafile!.outputs).flatMap(output => output.imports), []);
  // Injected Web APIs throw host TypeErrors, so preserve their error identity too.
  const realm = createContext({ TextEncoder, TextDecoder, TypeError, Uint8Array, ArrayBuffer, TransformStream,
    ReadableStream, WritableStream, AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask,
    crypto: globalThis.crypto, structuredClone, performance, URL, FormData, Blob, Headers, Response, Request, btoa, atob });
  assert.equal(runInContext("typeof Buffer + ':' + typeof process + ':' + typeof setImmediate", realm), "undefined:undefined:undefined");
  const api = runInContext(`(function(){ const module = { exports: {} }; ${result.outputFiles![0]!.text}; return module.exports; })()`, realm);
  assert.equal(runInContext("typeof Buffer + ':' + typeof process + ':' + typeof setImmediate", realm), "undefined:undefined:undefined");
  if (options.removeBuffer) {
    runInContext("delete globalThis.Buffer", realm);
    assert.equal(runInContext("typeof Buffer", realm), "undefined");
  }
  return { api: api as typeof import("../../src/core.js"), buffer: realm.Buffer as typeof Buffer };
}
