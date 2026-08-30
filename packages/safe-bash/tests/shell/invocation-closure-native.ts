import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { discoveryCases } from "./invocation-closure-cases.js";
import { readCases } from "./invocation-closure-read-cases.js";
import { shCases } from "./invocation-closure-sh-cases.js";
import type { ClosureCase } from "./invocation-closure-cases.js";

export const profiles = [
  { name: "GNU-5.3", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash" },
  { name: "historical-3.2", executable: "/bin/bash" },
] as const;
export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const hash = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
export interface Observation { stdout: string; stderr: string; status: number; files: Record<string, string> }
export async function sourceHashes(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir("src/shell")).filter(name => name.endsWith(".ts")).sort()) result[name] = hash(await readFile(`src/shell/${name}`));
  return result;
}

export async function bounded(executable: string, args: readonly string[], cwd: string, argv0: string, locale: string, stdin = ""): Promise<{ stdout: Buffer; stderr: Buffer; status: number }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], { cwd, argv0, detached: true, env: { PATH: "", LC_ALL: locale, LANG: locale, HOME: cwd, TZ: "UTC" }, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
    const timer = setTimeout(() => { failure = new Error("native process-group deadline"); kill(); }, 2500);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => { chunks.push(chunk); bytes += chunk.length; if (bytes > 256 * 1024) { failure = new Error("native output bound"); kill(); } });
    child.on("error", error => { failure = error; });
    child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") failure = error; });
    child.on("close", status => { clearTimeout(timer); kill(); if (failure) reject(failure); else if (status === null) reject(new Error("native signal termination")); else resolveResult({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), status }); });
    child.stdin.end(stdin);
  });
}

async function nativeFiles(directory: string, prefix = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, await nativeFiles(`${directory}/${entry.name}`, `${name}/`));
    else files[name] = (await readFile(`${directory}/${entry.name}`)).toString("base64");
  }
  return files;
}

export async function virtualObservation(fixture: ClosureCase, mode: "bash" | "sh", cwd = "/work"): Promise<Observation> {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /\/runtime\.ts$/u);
  const fs = new MemoryFileSystem();
  await fs.mkdir(cwd, { recursive: true });
  for (const [name, file] of Object.entries(fixture.files ?? {})) {
    await fs.mkdir(dirname(`${cwd}/${name}`), { recursive: true });
    await fs.writeFile(`${cwd}/${name}`, Buffer.from(file.text), { mode: file.mode });
  }
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) });
  const result = await shell.exec(`${mode} -c ${quote(fixture.source)} probe`, { cwd, env: { PATH: "", LC_ALL: fixture.locale ?? "C", LANG: fixture.locale ?? "C", TZ: "UTC", HOME: cwd }, stdin: fixture.stdin ?? "" });
  const files: Record<string, string> = {};
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(directory)) {
      if (entry.type === "directory") await visit(`${directory}/${entry.name}`, `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = Buffer.from(await fs.readFile(`${directory}/${entry.name}`)).toString("base64");
    }
  };
  await visit(cwd, "");
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, files };
}

export async function capture(cases: readonly ClosureCase[]) {
  const before = await sourceHashes();
  const evidence = [];
  for (const profile of profiles) {
    const version = await bounded(profile.executable, ["--version"], process.cwd(), "bash", "C");
    const observations = [];
    for (const mode of ["bash", "sh"] as const) for (const fixture of cases) {
      const directory = await mkdtemp(resolve(".invocation-closure-native-"));
      try {
        for (const [name, file] of Object.entries(fixture.files ?? {})) {
          await mkdir(dirname(`${directory}/${name}`), { recursive: true });
          await writeFile(`${directory}/${name}`, file.text);
          await chmod(`${directory}/${name}`, file.mode);
        }
        const result = await bounded(profile.executable, ["-c", fixture.source, "probe"], directory, mode, fixture.locale ?? "C", fixture.stdin);
        observations.push({ name: fixture.name, mode, cwd: directory, locale: fixture.locale ?? "C", observation: { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status, files: await nativeFiles(directory) } });
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
    evidence.push({ ...profile, version: version.stdout.toString(), sha256: hash(await readFile(profile.executable)), observations });
  }
  assert.deepEqual(await sourceHashes(), before);
  return { date: "2026-08-27", source: before, scenarios: hash(JSON.stringify(cases)), directShebangInterpreter: "/bin/bash (historical 3.2, even beneath primary parent)", profiles: evidence };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  assert.ok(["--capture", "--verify"].includes(process.argv[2] ?? ""));
  const cases = process.argv[3] === "sh" ? shCases : process.argv[3] === "read" ? readCases : discoveryCases;
  const reference = await capture(cases);
  if (process.argv[2] === "--capture") console.log(JSON.stringify(reference, null, 2));
  else {
    const results = [];
    for (const profile of reference.profiles) {
      const failures = [];
      for (const entry of profile.observations) {
        const actual = await virtualObservation(cases.find(fixture => fixture.name === entry.name)!, entry.mode, entry.cwd);
        try { assert.deepEqual(actual, entry.observation); }
        catch { failures.push({ name: entry.name, mode: entry.mode, expected: entry.observation, actual }); }
      }
      results.push({ profile: profile.name, executable: profile.executable, version: profile.version, sha256: profile.sha256, total: profile.observations.length, passed: profile.observations.length - failures.length, failures });
    }
    assert.deepEqual(await sourceHashes(), reference.source);
    console.log(JSON.stringify({ source: reference.source, scenarios: reference.scenarios, results }, null, 2));
    if (results.some(result => result.failures.length)) process.exitCode = 1;
  }
}
