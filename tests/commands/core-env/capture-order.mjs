import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { release } from "node:os";

const root = process.env.COREUTILS_ORACLE_ROOT ?? "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7";
const executable = join(root, "src/env");
const environment = { A: "old", B: "parent", C: "before" };
const vectors = [
  ["-i"], ["-i", "A=1", "B=2"], ["-i", "B=2", "A=1"], ["-i", "A=1", "B=2", "C=3"],
  ["-i", "A=1", "B=2", "A=3"], ["-i", "Z=1", "A=2", "M=3"],
  ["-i", "ONE=1", "TWO=2", "THREE=3", "FOUR=4"], ["-i", "1=x", "2=y", "X=z"],
  [], ["NEW=new"], ["A=new"], ["B=new"], ["-u", "A", "C=3"], ["A=new", "NEW=new"],
  ["-u", "A", "A=again"], ["-u", "B", "B=again", "D=new"], ["-u", "MISSING", "NEW=new"],
  ["-i", "EMPTY=", "VALUE=a=b"], ["-i", "__proto__=literal", "constructor=value"],
  ["-0", "-u", "A", "NEW=new"], ["-0", "-i", "A=1", "B=2", "A=3"],
  ["-i", "A=one\ntwo", "B=three"], ["-i", "DUP=1", "DUP=2", "LAST=3", "DUP=4"],
];
const observations = vectors.map(args => {
  const result = spawnSync(executable, args, { env: environment, timeout: 5000, maxBuffer: 65536 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr.length, 0);
  return { args, env: environment, stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), exitCode: result.status };
});
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = {
  capturedAt: new Date().toISOString(), executable, executableSha256: hash(await readFile(executable)),
  version: spawnSync(executable, ["--version"], { encoding: "utf8", env: environment }).stdout,
  host: { platform: process.platform, release: release(), node: process.version },
  sourceHashes: Object.fromEntries(await Promise.all(["src/env.c", "lib/putenv.c"].map(async path => [path, hash(await readFile(join(root, path)))]))),
  sourceFindings: "Pinned env.c calls putenv per assignment and emits environ in physical order. Included gnulib putenv.c replaces an existing slot; a new name is prepended. Observations establish this actual build profile, not a universal POSIX order or all GNU builds.",
  primaryReferences: ["https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/env.c", "https://raw.githubusercontent.com/coreutils/gnulib/master/lib/putenv.c"],
  observations,
};
const output = resolve(process.argv[2] ?? "tests/commands/core-env/native-order.json");
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output, observations: observations.length }));
