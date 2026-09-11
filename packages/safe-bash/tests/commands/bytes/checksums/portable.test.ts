import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import * as filesystem from "../../../../../safe-fs/src/core.js";
import type { ByteSource } from "../../../../src/contracts/index.js";

test("checksum browser graph has no Node crypto dependency", async () => {
  const platform = fileURLToPath(new URL("../../../../browser/platform.mjs", import.meta.url));
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../../../../src/commands/bytes/checksums/index.ts", import.meta.url))],
    bundle: true, write: false, metafile: true, platform: "browser", format: "cjs", target: "es2022",
    conditions: ["workerd", "worker", "browser"], external: ["poe-code/safe-fs/core"],
    alias: { "node:path": platform, "node:stream/web": platform }, inject: [platform], logLevel: "silent",
  });
  const external = Object.values(result.metafile!.outputs).flatMap(output => output.imports).filter(imported => imported.external);
  assert.deepEqual([...new Set(external.map(imported => imported.path))], ["poe-code/safe-fs/core"]);
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, AbortController, AbortSignal,
    setTimeout, clearTimeout,
    require(name: string) { assert.equal(name, "poe-code/safe-fs/core"); return filesystem; },
  });
  const checksums = runInContext(`(function(){ const module = { exports: {} }; ${result.outputFiles![0]!.text}; return module.exports; })()`, sandbox) as typeof import("../../../../src/commands/bytes/checksums/index.js");
  assert.equal(runInContext("typeof process + ':' + typeof Buffer + ':' + typeof crypto", sandbox), "undefined:undefined:undefined");
  const data = Uint8Array.from({ length: 131089 }, (_, index) => index % 251);
  for (const algorithm of ["md5", "sha1", "sha224", "sha256", "sha384", "sha512"]) {
    for (const size of [0, 3, data.length]) {
      const bytes = data.subarray(0, size);
      const digest = createHash(algorithm).update(bytes).digest("hex");
      for (const [name, args, expected] of [
        ["cksum", ["-a", algorithm], `${algorithm.toUpperCase()} (-) = ${digest}\n`],
        [`${algorithm}sum`, [], `${digest}  -\n`],
        [`${algorithm}sum`, ["--tag"], `${algorithm.toUpperCase()} (-) = ${digest}\n`],
      ] as const) {
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const stdin: ByteSource = (async function* () {
          for (let offset = 0; offset < bytes.length; offset += 65537) yield bytes.subarray(offset, offset + 65537);
        })();
        const command = checksums.createChecksumCommands().find(command => command.name === name)!;
        const executed = await command.execute({
          command: name, args, stdin, cwd: "/", env: {},
          fs: new filesystem.MemoryFileSystem(), signal: new AbortController().signal,
          stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
          stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
        });
        assert.equal(executed.exitCode, 0, Buffer.concat(stderr).toString());
        assert.equal(Buffer.concat(stdout).toString(), expected);
      }
    }
  }
});
