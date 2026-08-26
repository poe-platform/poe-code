import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { caseHash } from "./gnu-cases.js";
import { gzipBoundaryCases } from "./gzip-boundary-cases.js";
import { native } from "./helpers.js";

const program = process.env.BYTE_GNU_GZIP;
assert(program, "Set BYTE_GNU_GZIP to the pinned gzip 1.14 temporary build");
const version = await native(program, ["--version"]);
assert.equal(version.stdout.toString().split("\n")[0], "gzip 1.14");
const observations = [];
for (const value of gzipBoundaryCases()) {
  const result = await native(program, value.args, value.input, value.files ? { files: value.files } : {});
  observations.push({ name: value.name, caseSha256: caseHash(value), exitCode: result.exitCode,
    stdoutHex: result.stdout.toString("hex"), stderr: result.stderr.toString(),
    files: Object.fromEntries(Object.entries(result.files).map(([name, data]) => [name, data.toString("hex")])),
  });
}
console.log(JSON.stringify({ version: "gzip 1.14", sha256: createHash("sha256").update(await readFile(program)).digest("hex"), observations }, null, 2));
