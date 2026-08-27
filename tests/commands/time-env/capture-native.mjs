import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dateCases } from "./date-cases.ts";
import { run } from "./helpers.ts";

const directory = await mkdtemp(join(tmpdir(), "time-env-profile-"));
const gnu = join(process.cwd(), "tests/commands/metadata-stress/.oracle/coreutils-9.7/src");
const hash = data => createHash("sha256").update(data).digest("hex");
const rows = [];
const capture = (profile, binary, args, env = { LC_ALL: "C", TZ: "UTC" }) => {
  const result = spawnSync(binary, args, { cwd: directory, env, timeout: 3000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  const row = { profile, binary, args, env, status: result.status, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") };
  rows.push(row);
  return row;
};
try {
  const binaries = {};
  for (const name of ["date", "sleep", "printenv"]) {
    const path = join(gnu, name);
    binaries[`gnu-${name}`] = { path, sha256: hash(await readFile(path)), version: capture("GNU9.7 Darwin", path, ["--version"]) };
  }
  for (const path of ["/bin/date", "/bin/sleep", "/usr/bin/printenv"]) binaries[`apple-${path.split("/").at(-1)}`] = { path, sha256: hash(await readFile(path)) };
  for (const specimen of dateCases) {
    const native = capture("GNU9.7 Darwin exact date vectors", join(gnu, "date"), specimen.args, { TZ: "UTC", LC_ALL: "C", ...specimen.env });
    assert.equal(native.status, 0); assert.equal(Buffer.from(native.stdoutHex, "hex").toString(), specimen.stdout);
  }
  const gaps = [];
  for (const [label, args, env] of [
    ["ICU Kolkata zone label", ["-d@0", "+%Z %z"], { TZ: "Asia/Kolkata" }],
    ["ambiguous local fold explicitly rejected", ["-d2024-11-03T01:30:00", "+%s"], { TZ: "America/New_York" }],
    ["width above actual nanosecond precision unsupported", ["-d@0.123456789", "+%12N"], {}],
    ["GNU relative month grammar not implemented", ["-d2024-01-01 +1 month", "+%F"], {}],
  ]) {
    const expected = capture("GNU9.7 Darwin declared-scope counterexample", join(gnu, "date"), args, { TZ: "UTC", LC_ALL: "C", ...env });
    const actual = await run("date", args, { clock: () => 1709210096123 }, { env });
    gaps.push({ label, native: expected, virtual: { status: actual.exitCode, stdoutHex: actual.stdoutHex, stderr: actual.stderr }, acceptanceCredit: false });
  }
  for (const args of [["--", "0"], ["-0.00"], ["--help", "0"], ["0", "--help"], ["0x0"]]) capture("GNU9.7 Darwin sleep option/hex profile", join(gnu, "sleep"), args);
  for (const [args, env] of [
    [["-u", "-r", "0", "+%F %T %s %z %Z"], { TZ: "UTC", LC_ALL: "C" }],
    [["-u", "-r", "-1", "+%s %N"], { TZ: "UTC", LC_ALL: "C" }],
    [["-r", "1704067200", "+%F %T %z %Z"], { TZ: "America/New_York", LC_ALL: "C" }],
  ]) capture("Apple BSD read-only date profile", "/bin/date", args, env);
  for (const args of [["A"], ["A", "B"], ["-0", "A"], ["missing"]]) capture("Apple BSD printenv profile", "/usr/bin/printenv", args, { A: "雪", B: "" });
  for (const args of [[".001"], ["0", "0"], ["0s"], ["--", "0"]]) capture("Apple BSD bounded sleep profile", "/bin/sleep", args);
  const references = [];
  const path = join(directory, "mtime");
  await writeFile(path, "reference sentinel");
  for (const requested of [1700000000123, 1700000000125, -1250]) {
    await utimes(path, new Date(requested), new Date(requested));
    const metadata = await stat(path), precise = await stat(path, { bigint: true });
    references.push({ requestedMs: requested, observedMs: metadata.mtimeMs, observedNs: precise.mtimeNs.toString(),
      native: capture("GNU9.7 Darwin mtime provider control", join(gnu, "date"), ["-r", "mtime", "+%s %N"]) });
  }
  const sources = {};
  for (const path of ["src/date.c", "src/sleep.c", "src/printenv.c", "lib/long-options.c"]) {
    sources[path] = hash(await readFile(join(gnu, "..", path)));
  }
  await writeFile(process.argv[2], JSON.stringify({ capturedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    system: execFileSync("/usr/bin/sw_vers", ["-productVersion"]).toString().trim(), node: process.version, versions: process.versions,
    binaries, sources, rows, gaps, references, linuxControl: "not run", scopeCounterexamplesCountedAsAcceptance: false }, null, 2) + "\n", { flag: "wx" });
} finally { await rm(directory, { recursive: true }); }
