import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { caseHash } from "./gnu-cases.js";
import { decoderCases } from "./decoder-cases.js";
import { native } from "./helpers.js";

const directory = process.env.BYTE_GNU_COREUTILS_DIR;
assert(directory, "Set BYTE_GNU_COREUTILS_DIR to the pinned coreutils 9.7 build");
const identities: Record<string, { version: string; sha256: string }> = {};
for (const command of ["base64", "base32"]) {
  const program = join(directory, command);
  const result = await native(program, ["--version"]);
  const version = result.stdout.toString().split("\n")[0]!;
  assert.equal(version, `${command} (GNU coreutils) 9.7`);
  identities[command] = { version, sha256: createHash("sha256").update(await readFile(program)).digest("hex") };
}
const observations = [];
for (const value of decoderCases()) {
  const result = await native(join(directory, value.command), value.args, value.input);
  observations.push({ name: value.name, caseSha256: caseHash(value), exitCode: result.exitCode, stdoutHex: result.stdout.toString("hex"), stderr: result.stderr.toString() });
}
console.log(JSON.stringify({ identities, observations }, null, 2));
