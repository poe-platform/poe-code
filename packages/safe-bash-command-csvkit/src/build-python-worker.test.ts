import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

it("generates the Python worker in a clean checkout without an existing dist directory", async () => {
  const root = new URL("../", import.meta.url);
  const output = fileURLToPath(new URL("dist/python-worker-source.js", root));
  const wasm = createRequire(import.meta.url).resolve("@antonz/python-wasi/dist/python.wasm");
  const volume = Volume.fromJSON({
    [fileURLToPath(new URL("vendor/python/manifest.json", root))]: "[]",
    [wasm]: "wasm fixture"
  });
  vi.doMock("node:fs/promises", () => createFsFromVolume(volume).promises);
  vi.doMock("esbuild", () => ({ build: async () => ({ outputFiles: [{ text: "worker fixture" }] }) }));
  vi.doMock("../scripts/meter-python.mjs", () => ({ meterPythonWasm: (bytes: Uint8Array) => bytes }));
  try {
    // @ts-expect-error The standalone build script has no public TypeScript API.
    await import("../scripts/build-python-worker.mjs");
    expect(volume.readFileSync(output, "utf8")).toBe('export const source = "worker fixture";\n');
    expect(volume.readFileSync(output.replace(".js", ".d.ts"), "utf8")).toBe("export declare const source: string;\n");
  } finally {
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("esbuild");
    vi.doUnmock("../scripts/meter-python.mjs");
  }
});

it("avoids per-byte callback allocations when decoding the Python WASI bundle", async () => {
  const { readFileSync } = await import("node:fs");
  const workerSource = readFileSync(new URL("./python-wasi-worker.ts", import.meta.url), "utf8");
  expect(workerSource).not.toContain("Uint8Array.from(atob");
});
