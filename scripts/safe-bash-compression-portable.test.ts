import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { gzipSync, gunzipSync, zstdCompressSync } from "node:zlib";
import { expect, it } from "vitest";

it("bundles synchronous compression for workerd and preserves gzip byte results", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["packages/safe-bash/src/commands/bytes/compression/index.ts"],
    bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false,
  });
  const module = { exports: {} as { evalSyncCompression: (name: string, input: Uint8Array, args: string[]) => Uint8Array | undefined } };
  runInNewContext(result.outputFiles[0]!.text, { module, TextEncoder, TextDecoder, AbortController, AbortSignal });
  const run = module.exports.evalSyncCompression;
  const input = Uint8Array.from([0, 255, 128, 65, 0, 10]);
  const encoded = run("gzip", input, ["-c"]);
  expect(encoded).toBeDefined();
  expect([...gunzipSync(encoded!)]).toEqual([...input]);
  expect([...run("gunzip", gzipSync(input), ["-c"])!]).toEqual([...input]);
  expect([...run("zstdcat", zstdCompressSync(input), [])!]).toEqual([...input]);
  // Invalid compressed input returns to the command's diagnostic path.
  expect(run("zstdcat", Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0]), [])).toBeUndefined();
});
