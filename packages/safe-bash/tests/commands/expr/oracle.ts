import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const oraclePath = fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/expr", import.meta.url));
export const oracleHash = "e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c";

export function native(args: readonly string[], locale = "C") {
  assert.ok(args.length <= 128, "native probe argv count bound");
  assert.ok(args.reduce((total, argument) => total + Buffer.byteLength(argument), 0) <= 4096, "native probe argv byte bound");
  const result = spawnSync(oraclePath, args, { env: { LC_ALL: locale }, timeout: 2000, maxBuffer: 16_384 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, "native reference must settle within its bounded timeout");
  assert.notEqual(result.status, null);
  return { exitCode: result.status!, stdoutHex: result.stdout.toString("hex"), stderr: result.stderr.toString() };
}

export function qualifyOracle(): void {
  let bytes: Buffer;
  try { bytes = readFileSync(oraclePath); }
  catch (cause) { throw new Error(`GNU 9.7 expr qualification prerequisite missing: ${oraclePath}`, { cause }); }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), oracleHash, "GNU 9.7 expr binary identity");
  assert.match(Buffer.from(native(["--version"]).stdoutHex, "hex").toString(), /^expr \(GNU coreutils\) 9\.7\n/u);
  assert.equal(native(["length", "😀"], "C.UTF-8").stdoutHex, "310a", "GNU oracle C.UTF-8 scalar prerequisite");
}
