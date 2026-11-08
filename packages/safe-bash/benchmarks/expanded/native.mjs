import assert from "node:assert/strict";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { decode, encode, environment, fixedTime, fixtureRoot, hash, maximumBytes, projectBytes, relativePath, snapshot } from "./common.mjs";
import { defaultNames } from "./recipes.mjs";

export function executeNative(executable, args, options) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, argv0: options.argv0, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = []; let size = 0, reason;
    const collect = target => chunk => { size += chunk.length; if (size > maximumBytes) { reason = "native output limit"; child.kill("SIGKILL"); } else target.push(chunk); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.stdin.on("error", () => {}); child.stdin.end(options.stdin ?? Buffer.alloc(0));
    const timer = setTimeout(() => { reason = "native deadline"; child.kill("SIGKILL"); }, 8000);
    child.once("error", error => { reason = error.message; });
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code, signal, reason }); });
  });
}

export async function prepareNative(repo) {
  const workspace = await mkdtemp(join(tmpdir(), "safe-bash-expanded-native-")), bin = join(workspace, "bin");
  await mkdir(bin);
  const core = process.env.EXPANDED_COREUTILS ?? "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src";
  const gzip = process.env.EXPANDED_GZIP ?? "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/gzip-1.14/gzip";
  const bash = process.env.EXPANDED_BASH ?? "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash";
  const overrides = {
    bash, sh: bash, sed: process.env.EXPANDED_SED ?? "/tmp/safe-bash-gnu-sed-4.9.oqztSn/sed-4.9/sed/sed",
    awk: "/usr/bin/awk", grep: "/usr/bin/grep", find: "/usr/bin/find", xargs: "/usr/bin/xargs",
    jq: "/usr/bin/jq", xxd: "/usr/bin/xxd", curl: "/usr/bin/curl",
    rg: process.env.EXPANDED_RG ?? "/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-path/rg",
    gzip, gunzip: join(dirname(gzip), "gunzip"), zcat: join(dirname(gzip), "zcat"),
    tar: process.env.EXPANDED_TAR ?? join(repo, "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"),
    diff: process.env.EXPANDED_DIFF ?? "/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff",
    patch: process.env.EXPANDED_PATCH ?? "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch",
  };
  const tools = {};
  try {
    for (const name of [...new Set([...defaultNames, "bash", "sh", "curl"])]) {
      const executable = overrides[name] ?? join(core, name);
      await access(executable);
      await symlink(executable, join(bin, name));
      const args = name === "xxd" ? ["-v"] : ["--version"];
      const version = await executeNative(executable, args, { cwd: workspace, env: { PATH: bin, LC_ALL: "C", TZ: "UTC" }, argv0: name });
      tools[name] = { executable: await realpath(executable), sha256: hash(await readFile(executable)), versionExit: version.exitCode,
        versionStdout: version.stdout.toString().slice(0, 512), versionStderr: version.stderr.toString().slice(0, 512) };
    }
    assert.match(tools.bash.versionStdout, /version 5\.3\./u);
    assert.match(tools.stat.versionStdout, /GNU coreutils\) 9\.7/u);
    assert.match(tools.sed.versionStdout, /GNU sed\) 4\.9/u);
    return { workspace, bin, bash, tools, async close() { await rm(workspace, { recursive: true, force: true }); } };
  } catch (error) { await rm(workspace, { recursive: true, force: true }); throw error; }
}

export async function observeNative(profile, specimen, baseUrl) {
  const cwd = await mkdtemp(join(profile.workspace, "case-"));
  const scratch = await mkdtemp(join(profile.workspace, "scratch-"));
  const env = { ...environment, PATH: profile.bin, HOME: cwd, TMPDIR: scratch };
  const replacements = [[await realpath(cwd), fixtureRoot], [cwd, fixtureRoot], [await realpath(scratch), "/tmp"], [scratch, "/tmp"], [await realpath(profile.bin), "/usr/bin"], [profile.bin, "/usr/bin"], ...(baseUrl ? [[baseUrl, "{{BASE}}"]] : [])];
  try {
    await chmod(cwd, 0o755);
    for (const path of specimen.directories) await mkdir(join(cwd, relativePath(path)), { recursive: true, mode: 0o755 });
    for (const [path, bytes] of Object.entries(specimen.files)) {
      const target = join(cwd, relativePath(path)); await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, decode(bytes), { mode: specimen.fileModes[path] ?? 0o644 });
      const time = specimen.fileTimes?.[path] ?? fixedTime;
      await utimes(target, new Date(time), new Date(time));
    }
    const script = specimen.script.replaceAll("{{BASE}}", baseUrl ?? "network-unavailable");
    const result = await executeNative(profile.bash, ["--noprofile", "--norc", "-c", `umask 022\n${script}`, "benchmark"], { cwd, env, stdin: decode(specimen.stdin), argv0: "bash" });
    const entries = await snapshot({ list: readdir, read: readFile, link: readlink,
      stat: async path => { const info = await lstat(path); return { type: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other", mode: info.mode }; } }, specimen, cwd, replacements);
    return { stdout: encode(projectBytes(result.stdout, replacements)), stderr: encode(projectBytes(result.stderr, replacements)), exitCode: result.exitCode,
      entries, oracleValid: !result.reason && result.exitCode === specimen.nativeExit, reason: result.reason ?? null, signal: result.signal };
  } finally { await rm(cwd, { recursive: true, force: true }); await rm(scratch, { recursive: true, force: true }); }
}
