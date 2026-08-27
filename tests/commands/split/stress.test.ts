import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as native from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chunks, files, run } from "./helpers.js";
import { captureNativeReport, createNativeScratch } from "./native-capture.js";

const executable = fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/split", import.meta.url));

test("GNU boundary stress: complete effects under large chunks and reused windows", async context => {
  let binary: Uint8Array;
  try { binary = await native.readFile(executable); } catch { context.skip("pinned GNU9.7 oracle unavailable"); return; }
  assert.equal(createHash("sha256").update(binary).digest("hex"), "cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958");
  const records = Buffer.concat([Buffer.alloc(65535, 0xff), Buffer.from("\n"), Buffer.alloc(65537, 0), Buffer.from("\nlast\nunterminated")]);
  const binaryPattern = Buffer.alloc(16387);
  let seed = 1729;
  for (let index = 0; index < binaryPattern.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    binaryPattern[index] = (seed >>> 16) & 255;
  }
  const report: unknown[] = [];
  let failed = false;
  for (const [inputName, input] of [["64KiB-record-edges", records], ["seed1729-binary", binaryPattern]] as const) {
    for (const args of [["-C4096"], ["-C65536"], ["-b65536"], ["-l2"]]) {
      const temp = await createNativeScratch(context);
      const result = spawnSync(executable, args, { cwd: temp, input, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 10000 });
      const expectedFiles: Record<string, string> = {};
      for (const name of (await native.readdir(temp)).sort()) expectedFiles[name] = (await native.readFile(join(temp, name))).toString("hex");
      const expected = { status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString(), files: expectedFiles };
      const variants: unknown[] = [];
      let rowMatch = true;
      for (const chunkSize of [65537, 4093]) {
        const actual = await run(args, chunks(input, chunkSize, true), { limits: { maxChunkBytes: 4096 } });
        const observed = { status: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, files: await files(actual.fs) };
        let match = true;
        try { assert.deepEqual(observed, expected); } catch { match = false; failed = true; rowMatch = false; }
        variants.push({ chunkSize, match, outputFileHashes: Object.fromEntries(Object.entries(observed.files).map(([name, hex]) => [name, createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex")])), ...(!match ? { observed } : {}) });
      }
      report.push({ inputName, args, inputHex: input.toString("hex"), expected, variants, rowMatch });
      if (rowMatch) await native.rm(temp, { recursive: true });
    }
  }
  const path = await captureNativeReport(context, "stress", { profile: "GNU9.7 Darwin LC_ALL=C", report, failed }, failed);
  assert.equal(failed, false, `native boundary stress mismatch; evidence retained in ${path ?? "test diagnostics"}`);
});
