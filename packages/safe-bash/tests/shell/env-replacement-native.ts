import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const envExecutable = "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/env";
const profiles = [
  { name: "GNU-5.3-primary", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash" },
  { name: "Bash-3.2-historical", executable: "/bin/bash" },
];
interface Roles { env: string; bash: string; sh: string; cat: string; cwd: string }
const cases: { name: string; source: (roles: Roles) => string }[] = [
  { name: "nested-unset", source: role => `${role.env} -i A=1 B=2 ${role.env} -u A` },
  { name: "nested-pipeline", source: role => `${role.env} -i A=1 B=2 ${role.env} -u A | ${role.cat}` },
  { name: "third-generation", source: role => `${role.env} -i A=1 B=2 ${role.env} -u A ${role.env}` },
  { name: "empty", source: role => `${role.env} -i ${role.env}` },
  { name: "prefix-cleared", source: role => `TEMP=prefix ${role.env} -i ${role.env}` },
  { name: "unset-inherited", source: role => `${role.env} -u PUBLIC ${role.bash} -c 'printf "<%s>|<%s>\\n" "$PUBLIC" "$A"'` },
  { name: "bash-private", source: role => `SECRET=private; ${role.env} -i KEEP=value ${role.bash} -c 'printf "<%s>|<%s>|<%s>|<%s>\\n" "$PUBLIC" "$SECRET" "$KEEP" "$PWD"'` },
  { name: "sh-private", source: role => `SECRET=private; ${role.env} -i KEEP=value ${role.sh} -c 'printf "<%s>|<%s>|<%s>|<%s>\\n" "$PUBLIC" "$SECRET" "$KEEP" "$PWD"'` },
  { name: "cwd-PWD-data", source: role => `${role.env} -i -C ${quote(role.cwd + "/other")} PWD=caller ${role.env}` },
  { name: "cwd-empty", source: role => `${role.env} -i -C ${quote(role.cwd + "/other")} ${role.env}` },
  { name: "startup-PWD", source: role => `${role.env} -i -C ${quote(role.cwd + "/other")} PWD=caller ${role.bash} -c 'printf "%s\\n" "$PWD"'` },
  { name: "empty-and-equals", source: role => `${role.env} -i EMPTY= VALUE=a=b ${role.env}` },
  { name: "raw-order", source: role => `${role.env} -i A=1 B=2 C=3 ${role.env}` },
  { name: "parent-current-state", source: role => `SECRET=private; ${role.env} -i ${role.bash} -c 'cd ${quote(role.cwd + "/other")}; export PUBLIC=changed'; eval 'printf "%s|%s|%s\\n" "$PUBLIC" "$SECRET" "$PWD"'` },
];
const directory = await realpath(await mkdtemp("/tmp/safe-bash-env-replacement-native-"));
const cwd = directory + "/work";
await mkdir(cwd); await mkdir(cwd + "/other");
const environment = { PATH: "", PUBLIC: "parent", A: "ancestor", LC_ALL: "C", LANG: "C", HOME: cwd, TZ: "UTC" };
function bounded(executable: string, args: string[]) {
  const options = { argv0: "shell", cwd, env: environment, detached: true, timeout: 3000, maxBuffer: 256 * 1024 };
  const result = spawnSync(executable, args, options);
  if (result.pid) { try { process.kill(-result.pid, "SIGKILL"); } catch {} }
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.throws(() => process.kill(result.pid!, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
  return { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status };
}
const before = Object.fromEntries(await Promise.all(["src/shell/runtime.ts", "src/shell/types.ts", "src/shell/shell.ts", "src/contracts/command.ts", "src/commands/execution.ts", "tests/shell/env-replacement-native.ts"].map(async path => [path, hash(await readFile(path))])));
const observations = [];
try {
  const fs = createMemoryFileSystem(); await fs.mkdir(cwd + "/other", { recursive: true });
  const shell = new Shell({ fs, cwd, env: environment }).use(agentCommands());
  try {
    for (const fixture of cases) {
      const source = fixture.source({ env: "env", bash: "bash", sh: "sh", cat: "cat", cwd });
      const result = await shell.exec(source);
      observations.push({ name: fixture.name, virtualSource: source, virtual: { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode }, native: [] as unknown[] });
    }
  } finally { await shell.dispose(); }
  const provenance = [];
  for (const profile of profiles) {
    const sh = directory + "/" + profile.name + "/sh";
    await mkdir(directory + "/" + profile.name); await symlink(profile.executable, sh);
    provenance.push({ ...profile, sha256: hash(await readFile(profile.executable)), version: bounded(profile.executable, ["--version"]), childSh: { path: sh, target: profile.executable, mode: "actual sh basename symlink to this profile executable" } });
    for (const [index, fixture] of cases.entries()) {
      const source = fixture.source({ env: quote(envExecutable), bash: quote(profile.executable), sh: quote(sh), cat: "/bin/cat", cwd });
      const actual = bounded(profile.executable, ["--noprofile", "--norc", "-c", source, "shell"]);
      const virtual = observations[index]!.virtual;
      observations[index]!.native.push({ profile: profile.name, source, ...actual, exact: JSON.stringify(actual) === JSON.stringify(virtual) });
    }
  }
  const after = Object.fromEntries(await Promise.all(Object.keys(before).map(async path => [path, hash(await readFile(path))])));
  assert.deepEqual(after, before);
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), node: process.version, importedRuntime: import.meta.resolve("../../src/shell/runtime.js"), environment, cwd, before, after, provenance, env: { path: envExecutable, sha256: hash(await readFile(envExecutable)), version: bounded(envExecutable, ["--version"]) }, cat: { path: "/bin/cat", sha256: hash(await readFile("/bin/cat")) }, observations }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
