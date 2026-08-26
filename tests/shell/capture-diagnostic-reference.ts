import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnosticCases } from "./diagnostic-cases.js";

const profiles = [
  { name: "primary-5.3", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash", sha256: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c" },
  { name: "historical-3.2", executable: "/bin/bash", sha256: "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3" },
] as const;
const hash = (path: string | URL): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const fixtureHash = hash(new URL("./diagnostic-cases.ts", import.meta.url));
const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" };

async function capture(executable: string, args: readonly string[], cwd: string) {
  return await new Promise<{ stdoutBase64: string; stderrBase64: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { ...environment, HOME: cwd, TMPDIR: cwd }, detached: true, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: unknown;
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) failure ??= error; }
    };
    const timer = setTimeout(() => { failure ??= new Error("Native capture exceeded 2000ms"); kill(); }, 2000);
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      const available = 262144 - size;
      chunks.push(chunk.subarray(0, available));
      size += Math.min(available, chunk.length);
      if (chunk.length > available) { failure ??= new Error("Native capture exceeded 262144 bytes"); kill(); }
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", error => { failure ??= error; });
    child.stdin.on("error", error => { failure ??= error; });
    child.once("exit", kill);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (signal || exitCode === null) reject(new Error(`Native capture signal ${signal}`));
      else resolve({ stdoutBase64: Buffer.concat(stdout).toString("base64"), stderrBase64: Buffer.concat(stderr).toString("base64"), exitCode });
    });
    child.stdin.end();
  });
}

const captures = [];
for (const profile of profiles) {
  assert.equal(hash(profile.executable), profile.sha256);
  const directory = mkdtempSync(join(tmpdir(), "virtual-bash-diagnostic-version-"));
  let version: string;
  try { version = Buffer.from((await capture(profile.executable, ["--noprofile", "--norc", "--version"], directory)).stdoutBase64, "base64").toString().split("\n")[0]!; }
  finally { rmSync(directory, { recursive: true, force: true }); }
  const records = [];
  for (const fixture of diagnosticCases) {
    const repetitions = [];
    for (let repetition = 0; repetition < 2; repetition++) {
      const cwd = mkdtempSync(join(tmpdir(), "virtual-bash-diagnostic-reference-"));
      try {
        const result = await capture(profile.executable, ["--noprofile", "--norc", "-c", fixture.source, "shell"], cwd);
        repetitions.push({ ...result, files: Object.fromEntries(readdirSync(cwd).sort().map(name => [name, readFileSync(join(cwd, name)).toString("base64")])) });
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    }
    assert.deepEqual(repetitions[0], repetitions[1], fixture.name);
    records.push({ ...fixture, ...repetitions[0] });
  }
  assert.equal(hash(profile.executable), profile.sha256);
  captures.push({ ...profile, version, records });
}
assert.equal(hash(new URL("./diagnostic-cases.ts", import.meta.url)), fixtureHash);
const evidence = { argv0: "shell", environment, repetitions: 2, deadlineMs: 2000, maxOutputBytes: 262144, fixtureHash, captureHash: hash(new URL(import.meta.url)), captures };
process.stdout.write(`*** Begin Patch\n*** Add File: tests/shell/diagnostic-reference.json\n${JSON.stringify(evidence, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
