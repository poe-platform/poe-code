import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { findUnreachableBundleOutputs } from "./bundle-graph.mjs";
import { buildBrowserShellOutputs, resolveBrowserShellBuild, resolvePortableBufferBuild } from "./bundle-safe-bash.mjs";

vi.mock("esbuild", async importOriginal => {
  const actual = await importOriginal<typeof import("esbuild")>();
  return { ...actual, build: vi.fn(actual.build) };
});

it("keeps the legacy bootstrap importable without installing a Buffer global", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await build({ ...resolvePortableBufferBuild(root), sourcemap: false });
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  const script = result.outputFiles!.find(output => output.path.endsWith("/portable-buffer.js"))!.text;
  const sandbox = createContext({ TextEncoder, TextDecoder, Uint8Array });
  runInContext(script, sandbox);
  expect(runInContext('typeof Buffer + ":" + typeof process + ":" + typeof setImmediate', sandbox)).toBe("undefined:undefined:undefined");
  const native = createContext({ TextEncoder, TextDecoder, Uint8Array, Buffer });
  runInContext(script, native);
  expect(native.Buffer).toBe(Buffer);
});

it("keeps third-party Buffer adapters local even when a host global exists", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await build({
    entryPoints: [path.join(root, "packages/safe-bash/browser/buffer.mjs")],
    bundle: true, platform: "browser", format: "iife", globalName: "adapter", write: false,
  });
  const sandbox = createContext({ TextEncoder, TextDecoder, Uint8Array, Buffer: { host: true } });
  runInContext(result.outputFiles![0]!.text, sandbox);
  expect(runInContext('adapter.Buffer.from("é").toString("hex")', sandbox)).toBe("c3a9");
  expect(runInContext('Buffer.host', sandbox)).toBe(true);
});

it("preserves browser chunks when publishing the standalone bootstrap", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const actual = await vi.importActual<typeof import("esbuild")>("esbuild");
  // Exercise real chunk emission and publication with small in-memory modules.
  // The separate browser suite verifies the complete shell implementation.
  vi.mocked(build).mockImplementationOnce(options => actual.build({
    ...options, alias: {}, external: [], inject: [],
    plugins: [{
      name: "publication-fixture",
      setup(builder) {
        const shared = path.join(root, "publication-shared.ts");
        builder.onResolve({ filter: /^publication-shared$/ }, () => ({ path: shared }));
        builder.onLoad({ filter: /.*/ }, args => ({
          contents: args.path === shared
            ? 'export const marker = "shared publication chunk";'
            : 'export { marker } from "publication-shared";',
          loader: "js",
        }));
      },
    }],
  }));
  const volume = new Volume();
  volume.mkdirSync(path.join(root, "packages/safe-bash"), { recursive: true });
  const result = await buildBrowserShellOutputs(root, { files: createFsFromVolume(volume).promises });
  const unreachable = new Set(findUnreachableBundleOutputs(result.metafile, Object.values(resolveBrowserShellBuild(root).entryPoints), root).map(f => path.resolve(root, f)));
  for (const output of result.outputFiles) {
    if (!unreachable.has(path.resolve(root, output.path))) expect(volume.existsSync(output.path), output.path).toBe(true);
  }
  const chunks = result.outputFiles.filter(output => output.path.includes(`${path.sep}chunks${path.sep}`));
  expect(chunks.length).toBeGreaterThan(0);
  for (const chunk of chunks) expect(new Uint8Array(volume.readFileSync(chunk.path) as Buffer)).toEqual(chunk.contents);
  expect(Object.keys(result.metafile.inputs).some(input => input.endsWith("browser/buffer.mjs"))).toBe(false);
  const script = volume.readFileSync(path.join(root, "packages/safe-bash/dist/portable-buffer.js"), "utf8").toString();
  const realm = createContext({ TextEncoder, TextDecoder, Uint8Array });
  runInContext(script, realm);
  expect(runInContext('typeof Buffer', realm)).toBe("undefined");
});
