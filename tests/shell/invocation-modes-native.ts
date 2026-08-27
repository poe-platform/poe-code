import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { invocationFixtures } from "./invocation-modes-cases.js";
import type { InvocationFixture } from "./invocation-modes-cases.js";

export const profiles = [
  { name: "primary-5.3", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash", sha256: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c" },
  { name: "historical-3.2", executable: "/bin/bash", sha256: "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3" },
] as const;
export const hash = (path: string | URL): string => createHash("sha256").update(readFileSync(path)).digest("hex");
export const shellHashes = (): Record<string, string> => Object.fromEntries(["runtime", "shell", "input", "parser", "types", "index"].map(name => [name, hash(new URL(`../../src/shell/${name}.ts`, import.meta.url))]));
export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export type Snapshot = Record<string, { file: string } | { link: string } | { directory: true }>;
export interface Observation { stdout: string; stderr: string; status: number; files: Snapshot }
export interface Reference { fixtureHash: string; profiles: { name: string; executable: string; sha256: string; version: string; records: { name: string; mode: "bash" | "sh"; result: Observation }[] }[] }

export async function virtualObservation(fixture: InvocationFixture, mode: "bash" | "sh"): Promise<Observation> {
  const fs = new MemoryFileSystem();
  for (const [name, entry] of Object.entries(fixture.files ?? {})) {
    await fs.mkdir(dirname(`/${name}`), { recursive: true });
    if (entry.directory) await fs.mkdir(`/${name}`);
    else if (entry.link !== undefined) await fs.symlink(entry.link, `/${name}`);
    else await fs.writeFile(`/${name}`, entry.bytes ? Uint8Array.from(entry.bytes) : new TextEncoder().encode(entry.text ?? ""), { mode: entry.mode ?? 0o644 });
  }
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", PUBLIC: "exported" } });
  const result = await shell.exec([mode, ...fixture.args].map(quote).join(" "), { stdin: typeof fixture.stdin === "string" || fixture.stdin === undefined ? fixture.stdin ?? "" : Uint8Array.from(fixture.stdin), signal: AbortSignal.timeout(2000) });
  const snapshot: Snapshot = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await fs.readdir(directory)).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = `${directory === "/" ? "" : directory}/${entry.name}`;
      snapshot[path.slice(1)] = entry.type === "directory" ? { directory: true } : entry.type === "symlink" ? { link: await fs.readlink(path) } : { file: Buffer.from(await fs.readFile(path)).toString("base64") };
      if (entry.type === "directory") await visit(path);
    }
  };
  await visit("/");
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, files: snapshot };
}

function nativeObservation(executable: string, mode: "bash" | "sh", fixture: InvocationFixture): Observation {
  const directory = mkdtempSync(join(process.cwd(), ".invocation-modes-native-"));
  try {
    for (const [name, entry] of Object.entries(fixture.files ?? {})) {
      const path = join(directory, name);
      mkdirSync(dirname(path), { recursive: true });
      if (entry.directory) mkdirSync(path);
      else if (entry.link !== undefined) symlinkSync(entry.link, path);
      else { writeFileSync(path, entry.bytes ? Buffer.from(entry.bytes) : entry.text ?? ""); chmodSync(path, entry.mode ?? 0o644); }
    }
    const result = spawnSync(executable, [...fixture.args], { argv0: mode, cwd: directory, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: directory, PUBLIC: "exported" }, input: typeof fixture.stdin === "string" || fixture.stdin === undefined ? fixture.stdin ?? "" : Buffer.from(fixture.stdin), timeout: 2000, maxBuffer: 262144 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    const snapshot: Snapshot = {};
    const visit = (relative: string): void => {
      for (const name of readdirSync(join(directory, relative)).sort()) {
        const path = relative ? `${relative}/${name}` : name;
        const stat = lstatSync(join(directory, path));
        snapshot[path] = stat.isDirectory() ? { directory: true } : stat.isSymbolicLink() ? { link: readlinkSync(join(directory, path)) } : { file: readFileSync(join(directory, path)).toString("base64") };
        if (stat.isDirectory()) visit(path);
      }
    };
    visit("");
    return { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status!, files: snapshot };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function main(): Promise<void> {
  const before = shellHashes();
  assert.ok(import.meta.resolve("../../src/shell/runtime.js").endsWith("/runtime.ts"));
  const fixtureHash = hash(new URL("./invocation-modes-cases.ts", import.meta.url));
  const captured: Reference = { fixtureHash, profiles: [] };
  for (const profile of profiles) {
    assert.equal(hash(profile.executable), profile.sha256);
    const version = spawnSync(profile.executable, ["--version"], { encoding: "utf8", env: { LC_ALL: "C" }, timeout: 2000, maxBuffer: 262144 });
    assert.equal(version.status, 0);
    const records = [];
    for (const mode of ["bash", "sh"] as const) for (const fixture of invocationFixtures) records.push({ name: fixture.name, mode, result: nativeObservation(profile.executable, mode, fixture) });
    assert.equal(hash(profile.executable), profile.sha256);
    captured.profiles.push({ ...profile, version: version.stdout.split("\n")[0]!, records });
  }
  assert.equal(hash(new URL("./invocation-modes-cases.ts", import.meta.url)), fixtureHash);
  assert.deepEqual(shellHashes(), before);
  if (process.argv.includes("--capture")) console.log(JSON.stringify(captured));
  else {
    const frozen = JSON.parse(readFileSync(new URL("./invocation-modes-reference.json", import.meta.url), "utf8")) as Reference;
    assert.deepEqual(captured, frozen, "native reference changed; do not overwrite silently");
    const comparisons = [];
    for (const profile of captured.profiles) {
      const failures = [];
      for (const record of profile.records) {
        const actual = await virtualObservation(invocationFixtures.find(fixture => fixture.name === record.name)!, record.mode);
        if (!isDeepStrictEqual(actual, record.result)) failures.push({ name: record.name, mode: record.mode, expected: record.result, actual });
      }
      comparisons.push({ profile: profile.name, total: profile.records.length, passed: profile.records.length - failures.length, failures });
    }
    assert.deepEqual(shellHashes(), before);
    console.log(JSON.stringify({ sourceHashes: before, fixtureHash, actualRuntimeResolution: import.meta.resolve("../../src/shell/runtime.js"), comparisons }, null, 2));
    if (comparisons.some(profile => profile.failures.length)) process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("invocation-modes-native.ts")) await main();
