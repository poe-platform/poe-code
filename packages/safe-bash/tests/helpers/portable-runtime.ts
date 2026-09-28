import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";

export async function portableRuntime(contents: string) {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const { resolveBrowserShellBuild } = await import(new URL("../../../../scripts/bundle-safe-bash.mjs", import.meta.url).href);
  const options = resolveBrowserShellBuild(root);
  const filesystem = path.join(root, "packages/safe-fs/src/core.ts");
  const result = await build({
    ...options, loader: { ...options.loader, ".wasm": "binary" }, external: [], entryPoints: undefined, splitting: false, format: "cjs", sourcemap: false,
    alias: { ...options.alias,
      "@poe-code/safe-fs": filesystem,
      "@poe-code/safe-fs/core": filesystem,
      "@poe-code/safe-fs/xml": filesystem,
      "@poe-code/safe-fs/contracts/errors": filesystem,
      "@poe-code/safe-fs/contracts/object": filesystem,
      "poe-code/safe-fs/core": filesystem,
      "poe-code/safe-fs": filesystem,
    },
    stdin: { contents, resolveDir: root },
  });
  assert.deepEqual(Object.values(result.metafile!.outputs).flatMap(output => output.imports), []);
  const realm = createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream,
    ReadableStream, WritableStream, AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask,
    crypto: globalThis.crypto, performance, URL, FormData, Blob, Response, Request, btoa, atob });
  assert.equal(runInContext("typeof Buffer + ':' + typeof process", realm), "undefined:undefined");
  const api = runInContext(`(function(){ const module = { exports: {} }; ${result.outputFiles![0]!.text}; return module.exports; })()`, realm);
  assert.equal(runInContext("typeof Buffer + ':' + typeof process", realm), "function:undefined");
  return { api: api as typeof import("../../src/core.js"), buffer: realm.Buffer as typeof Buffer };
}
