import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, lstat, readlink, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { vectors } from "./vectors.js";

const tools = process.env.CORE_GNU_BIN;
if (!tools || !isAbsolute(tools)) throw new Error("Set CORE_GNU_BIN to existing GNU binaries");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const versions = {};
for (const name of ["wc", "realpath", "cksum", "sort"]) {
  const path = join(tools, name), version = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 3000 }).split("\n")[0]!;
  if (!version.includes("GNU coreutils")) throw new Error(version);
  Object.assign(versions, { [name]: { path, version, sha256: sha(await readFile(path)) } });
}
const observations = [];
for (const vector of vectors) {
  const root = await mkdtemp(join(tmpdir(), "safe-core-native-review-"));
  try {
    for (const directory of vector.directories ?? []) await mkdir(join(root, directory), { recursive: true });
    for (const [name, value] of Object.entries(vector.files ?? {})) { await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), Buffer.from(value, "base64")); }
    for (const [name, target] of Object.entries(vector.links ?? {})) await symlink(target, join(root, name));
    const result = spawnSync(join(tools, vector.command), vector.args, { cwd: root, env: { PATH: tools, LC_ALL: "C", TZ: "UTC", ...vector.env },
      input: Buffer.from(vector.stdin ?? "", "base64"), timeout: 5000, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status === null) throw result.error ?? new Error(vector.name);
    const files: Record<string, string> = {};
    async function walk(path = "") {
      for (const name of (await readdir(join(root, path))).sort()) {
        const relative = path ? `${path}/${name}` : name, absolute = join(root, relative), stat = await lstat(absolute);
        if (stat.isDirectory()) await walk(relative);
        else files[relative] = stat.isSymbolicLink() ? `link:${await readlink(absolute)}` : (await readFile(absolute)).toString("base64");
      }
    }
    await walk();
    const physical = await realpath(root);
    const stdout = vector.command === "realpath" ? Buffer.from(result.stdout.toString().replaceAll(physical, "/work").replaceAll(root, "/work")) : result.stdout;
    observations.push({ name: vector.name, vectorSha256: sha(Buffer.from(JSON.stringify(vector))), stdout: stdout.toString("base64"), stderr: result.stderr.toString(), exitCode: result.status, files });
  } finally { await rm(root, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), platform: process.platform, versions, observations }, null, 2));
