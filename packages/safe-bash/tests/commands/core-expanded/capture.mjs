import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { wcVectors, realpathVectors, files } from "./vectors.ts";

const core = process.env.COREUTILS_ORACLE_ROOT ?? "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src";
const directory = await mkdtemp(join(tmpdir(), "safe-core-oracle-"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  for (const [name, text] of Object.entries(files)) { await mkdir(dirname(join(directory, name)), { recursive: true }); await writeFile(join(directory, name), text); }
  await symlink("tree", join(directory, "alias"));
  const physical = await realpath(directory);
  const observe = (command, args, stdin = "", env = { LC_ALL: "C" }) => {
    const row = spawnSync(join(core, command), args, { cwd: directory, input: stdin, env: { ...env, TZ: "UTC" }, timeout: 5000 });
    if (row.error) throw row.error;
    return { stdout: row.stdout.toString().replaceAll(physical, "/work").replaceAll(directory, "/work"), stderr: row.stderr.toString(), exitCode: row.status };
  };
  const tools = {};
  for (const name of ["wc", "realpath", "env"]) tools[name] = { path: join(core, name), sha256: sha256(await readFile(join(core, name))), version: execFileSync(join(core, name), ["--version"], { encoding: "utf8" }).split("\n")[0] };
  const report = { capturedAt: new Date().toISOString(), tools,
    wc: wcVectors.map(vector => ({ ...vector, ...observe("wc", vector.args, vector.stdin, vector.env) })),
    realpath: realpathVectors.map(args => ({ args, ...observe("realpath", args) })),
    environmentOrder: [["-i", "A=1", "B=2"], ["-i", "B=2", "A=1"], ["-i", "ONE=1", "TWO=2", "THREE=3"]].map(args => ({ args, ...observe("env", args) })),
    sourceSha256: sha256(await readFile(new URL("vectors.ts", import.meta.url))) };
  await writeFile(new URL("native.json", import.meta.url), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ wc: report.wc.length, realpath: report.realpath.length, errors: [...report.wc, ...report.realpath].filter(row => row.exitCode !== 0) }));
} finally { await rm(directory, { recursive: true, force: true }); }
