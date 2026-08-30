import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { discoveryFixCases, discoveryFixFiles, discoveryFixFileText } from "./invocation-discovery-fixes-cases.js";

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const profiles = [
  { name: "GNU-5.3", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash" },
  { name: "historical-3.2", executable: "/bin/bash" },
];
const children: number[] = [];
async function bounded(executable: string, args: string[], cwd: string, mode: "bash" | "sh") {
  return new Promise<{ stdoutHex: string; stderrHex: string; status: number }>((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd, argv0: mode, detached: true, env: { PATH: "", LC_ALL: "C", LANG: "C", HOME: cwd, TZ: "UTC" }, stdio: "pipe" });
    if (child.pid) children.push(child.pid);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
    const timer = setTimeout(() => { failure = new Error("native deadline"); stop(); }, 2500);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk); size += chunk.length;
      if (size > 256 * 1024) { failure = new Error("native output cap"); stop(); }
    });
    child.on("error", error => { failure = error; });
    child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") failure = error; });
    child.on("close", status => {
      clearTimeout(timer); stop();
      if (failure) reject(failure);
      else if (status === null) reject(new Error("native signal termination"));
      else resolveResult({ stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex"), status });
    });
    child.stdin.end();
  });
}

async function snapshot(cwd: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(resolve(cwd, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) entries[path] = `link:${await readlink(resolve(cwd, path))}`;
      else if (entry.isDirectory()) { entries[path] = "directory"; await walk(path); }
      else entries[path] = `file:${(await readFile(resolve(cwd, path))).toString("hex")}`;
    }
  }
  await walk("");
  return entries;
}

const output = process.argv[2];
assert.ok(output, "provide a NEW capture filename");
const report = { generatedAt: new Date().toISOString(), locale: "C", casesSha256: digest(await readFile(new URL("./invocation-discovery-fixes-cases.ts", import.meta.url))), profiles: [] as unknown[], children, allChildrenAbsent: false };
for (const profile of profiles) {
  const root = await mkdtemp(resolve("tests/shell/.invocation-discovery-fixes-native-"));
  try {
    const executableHash = digest(await readFile(profile.executable));
    const version = await bounded(profile.executable, ["--version"], root, "bash");
    const observations = [];
    for (const mode of ["bash", "sh"] as const) for (const fixture of discoveryFixCases) {
      const cwd = resolve(root, `${mode}-${fixture.name}`);
      for (const file of discoveryFixFiles) {
        const path = resolve(cwd, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, discoveryFixFileText); await chmod(path, 0o755);
      }
      await symlink("closuretool", resolve(cwd, "tools/linktool"));
      const before = await snapshot(cwd);
      const args = ["--noprofile", "--norc", "-c", fixture.source, "shell"];
      const result = await bounded(profile.executable, args, cwd, mode);
      const after = await snapshot(cwd);
      assert.deepEqual(after, before, `${profile.name}/${mode}/${fixture.name}: file effects`);
      observations.push({ name: fixture.name, mode, cwd, argv0: mode, args, source: fixture.source, before, after, result });
    }
    report.profiles.push({ ...profile, executableHash, version, observations });
  } finally { await rm(root, { recursive: true, force: true }); }
}
for (const pid of children) for (const target of [pid, -pid]) {
  assert.throws(() => process.kill(target, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
}
report.allChildrenAbsent = true;
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(`Captured ${discoveryFixCases.length * 2} rows per profile; ${children.length} children absent`);
