import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { tableTextCommands } from "../../../src/commands/table-text/index.js";
import { nativeGnuBinding, verifyNativeExecutable, type NativeGnuOptions } from "../../native-profile.js";

export const directory = resolve("tests/commands/table-text-stress");
export const oracle = resolve("tests/commands/metadata-stress/.oracle/coreutils-9.7");
export const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export interface Fixture { name: string; command: "paste" | "comm" | "join"; args: string[]; files: Record<string, string>; stdinHex: string }
export interface Row { exitCode: number; stdoutHex: string; stderrHex: string; files: Record<string, string> }
export function nativePath(command: Fixture["command"], options: NativeGnuOptions = {}): string {
  const binding = nativeGnuBinding(command, options);
  if (!binding) return `${oracle}/src/${command}`;
  verifyNativeExecutable(binding, binding.path, options);
  return binding.path;
}
export function save(name: string, data: unknown): void {
  assert.equal(existsSync(`${directory}/${name}`), false, `evidence is immutable: ${name}`);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${directory}/${name}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { input: patch, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
export async function hashes() {
  const values: Record<string, string> = {};
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else values[child] = hash(await readFile(child));
    }
  };
  await walk("src");
  await walk("tests/commands/table-text");
  for (const path of ["tests/plugins/agent-commands.test.ts", "tests/integration/adapter-tools-diagnostics/eight-cases.test.ts", "tests/integration/adapter-tools-diagnostics/reference.json", "tests/integration/adapter-tools/fixtures.ts", "tests/integration/adapter-tools/preflight-review/preflight.ts", "tests/fs/webdav/mock.ts", "tests/commands/structured-stress/split-increment/interop.test.ts", "tests/commands/structured-stress/split-increment/evidence.ts", "tests/commands/structured-stress/split-increment/native.json", "tests/commands/structured-stress/final-increment/fresh-interop.test.ts", "tests/commands/structured-stress/final-increment/fresh-native.json"]) values[path] = hash(await readFile(path));
  for (const entry of await readdir(directory)) if (entry.endsWith(".ts") || ["frozen-corpus.json", "first-discrepancy.json", "tsconfig.json", "PLAN.md"].includes(entry)) values[`tests/commands/table-text-stress/${entry}`] = hash(await readFile(`${directory}/${entry}`));
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", "node_modules/tsx/package.json", "node_modules/typescript/package.json"]) values[path] = hash(await readFile(path));
  return { head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), files: values };
}
export async function verifyOracle(): Promise<void> {
  const frozen: { identities: Record<string, { version: string; sha256: string }>; archiveSha256: string; manualSha256: string } = JSON.parse(await readFile(`${directory}/first-discrepancy.json`, "utf8"));
  assert.equal(hash(await readFile(`${oracle}.tar.xz`)), frozen.archiveSha256);
  assert.equal(hash(await readFile(`${oracle}/doc/coreutils.texi`)), frozen.manualSha256);
  for (const command of ["paste", "comm", "join"] as const) {
    const binary = nativePath(command);
    if (binary === `${oracle}/src/${command}`) assert.equal(hash(await readFile(binary)), frozen.identities[command]!.sha256);
    const result = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000, env: { LC_ALL: "C" } });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.split("\n")[0], `${command} (GNU coreutils) 9.7`);
  }
}
export async function native(fixture: Fixture): Promise<Row> {
  const cwd = await mkdtemp(`${tmpdir()}/safe-bash-table-native-`);
  try {
    await writeFile(`${cwd}/sentinel`, "independent-table-text-owned");
    for (const [name, hex] of Object.entries(fixture.files)) await writeFile(`${cwd}/${name}`, Buffer.from(hex, "hex"));
    const result = spawnSync(nativePath(fixture.command), fixture.args, { cwd, input: Buffer.from(fixture.stdinHex, "hex"), env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    const files: Record<string, string> = {};
    for (const name of Object.keys(fixture.files)) files[name] = (await readFile(`${cwd}/${name}`)).toString("hex");
    assert.deepEqual((await readdir(cwd)).sort(), [...Object.keys(files), "sentinel"].sort());
    assert.equal(await readFile(`${cwd}/sentinel`, "utf8"), "independent-table-text-owned");
    return { exitCode: result.status!, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex"), files };
  } finally {
    await rm(cwd, { recursive: true });
  }
}
export async function product(fixture: Fixture, pipeline = true): Promise<Row> {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, hex] of Object.entries(fixture.files)) await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
  await fs.writeFile("/work/input", Buffer.from(fixture.stdinHex, "hex"));
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(standardCommands()).use(tableTextCommands());
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    const invocation = [fixture.command, ...fixture.args].map(quote).join(" ");
    const result = await shell.exec(pipeline ? `cat input | ${invocation}` : `${invocation} < input`, { signal: AbortSignal.timeout(5000) });
    const files: Record<string, string> = {};
    for (const name of Object.keys(fixture.files)) files[name] = Buffer.from(await fs.readFile(`/work/${name}`)).toString("hex");
    assert.equal(Buffer.from(await fs.readFile("/work/input")).toString("hex"), fixture.stdinHex);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), [...Object.keys(files), "input"].sort());
    return { exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), files };
  } finally { await shell.dispose(); }
}
