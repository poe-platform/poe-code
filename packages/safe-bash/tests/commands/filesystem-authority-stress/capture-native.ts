import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, lstat, readlink, writeFile, symlink, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { nativeFixtures } from "./native-fixtures.js";

const directory = process.env.CORE_GNU_BIN;
if (!directory || !isAbsolute(directory)) throw new Error("CORE_GNU_BIN must name an existing absolute GNU coreutils bin directory");
const tools = await Promise.all((["cp", "mv"] as const).map(async name => {
  const path = join(directory, name);
  const version = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 3000 }).split("\n")[0]!;
  if (!version.includes("GNU coreutils")) throw new Error(`${name} is not GNU coreutils`);
  return { name, path, version, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
}));
const observations = [];
for (const fixture of nativeFixtures) {
  const root = await mkdtemp(join(tmpdir(), "safe-core-native-"));
  try {
    for (const [name, data] of Object.entries(fixture.files)) await writeFile(join(root, name), Buffer.from(data, "base64"));
    for (const [name, target] of Object.entries(fixture.links ?? {})) await symlink(target, join(root, name));
    for (const [name, target] of Object.entries(fixture.hardlinks ?? {})) await link(join(root, target), join(root, name));
    const tool = tools.find(tool => tool.name === fixture.command)!;
    const result = spawnSync(tool.path, [...fixture.args], { cwd: root, env: { LC_ALL: "C", TZ: "UTC", PATH: directory }, timeout: 3000, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status === null) throw result.error ?? new Error(`native ${fixture.name} did not exit`);
    const entries: Record<string, { kind: "file" | "symlink"; value: string }> = {};
    for (const name of (await readdir(root)).sort()) {
      const path = join(root, name), stat = await lstat(path);
      entries[name] = stat.isSymbolicLink() ? { kind: "symlink", value: await readlink(path) } : { kind: "file", value: (await readFile(path)).toString("base64") };
    }
    observations.push({ name: fixture.name, exitCode: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString().replaceAll(tool.path, fixture.command), entries });
  } finally { await rm(root, { recursive: true, force: true }); }
}
process.stdout.write(JSON.stringify({ capturedAt: new Date().toISOString(), platform: process.platform, tools, observations }, null, 2) + "\n");
