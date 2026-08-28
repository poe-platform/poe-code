import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TableCase } from "../../table-text/cases.js";
import { runTable } from "../../table-text/helpers.js";
import { product, type Row } from "../support.js";

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, "../../../..");
export const runtime = resolve(directory, ".runtime");
export const oracle = resolve(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7");
export const authorArgv0Directory = "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src";
export const sha = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const sourcePaths = ["comm.ts", "index.ts", "internal.ts", "join.ts", "paste.ts", "README.md"].map(name => `src/commands/table-text/${name}`);
export const pins: Record<string, string> = {
  "src/comm": "86a541de8aa5d90c3404d5b88bc3646be9b2481736be5bafe5ee234522416fd3",
  "src/paste": "2386f4764d553fcd831e5bbe7a3a6b43110dd2d2cabd610115a3cc427acf323c",
  "src/join": "70364217db6a709fb414718e3941f4dd40b4810f51f5b58047e58e1cb4f6e123",
  "src/comm.c": "3517b5f9e88bbb67ce93e3075811d0856647104ca83c40001f7fa2dcf07c7336",
  "doc/coreutils.texi": "39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca",
};
export async function save(name: string, value: unknown): Promise<void> {
  const path = resolve(directory, name);
  assert.equal(dirname(path), directory);
  assert.equal(existsSync(path), false, `immutable capture ${path}`);
  const text = JSON.stringify(value, null, 2);
  const result = spawnSync("apply_patch", [], { encoding: "utf8", input: `*** Begin Patch\n*** Add File: ${path}\n${text.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
  assert.equal(result.status, 0, result.stderr);
}
export async function manifest(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else files[child] = sha(await readFile(child));
    }
  };
  await walk("src");
  await walk("tests/commands/table-text");
  for (const path of ["tests/fs/webdav/mock.ts", "tests/commands/table-text-stress/frozen-corpus.json", "tests/commands/table-text-stress/first-discrepancy.json", "tests/commands/diff-patch-stress/routed-five-review/table-inputs.json", "package.json", "package-lock.json", "tsconfig.json", "node_modules/tsx/package.json", "node_modules/typescript/package.json"]) files[path] = sha(await readFile(path));
  return files;
}
export async function verifyOracle(): Promise<void> {
  const parent = await mkdtemp(`${tmpdir()}/safe-bash-table-version-`);
  try {
    assert.equal(sha(await readFile(`${oracle}.tar.xz`)), "e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf");
    for (const [path, digest] of Object.entries(pins)) assert.equal(sha(await readFile(`${oracle}/${path}`)), digest, path);
    for (const command of ["comm", "paste", "join"]) {
      const result = spawnSync(`${oracle}/src/${command}`, ["--version"], { cwd: parent, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0);
      assert.equal(result.stdout.split("\n")[0], `${command} (GNU coreutils) 9.7`);
    }
  } finally {
    await rmdir(parent);
  }
}
export async function native(fixture: TableCase): Promise<Row> {
  const parent = await mkdtemp(`${tmpdir()}/safe-bash-table-shared-`);
  try {
    const cwd = await mkdtemp(`${parent}/native-`);
    const sentinel = "shared-stdin-fix-owned";
    let sentinelWritten = false;
    try {
      await writeFile(`${cwd}/sentinel`, sentinel);
      sentinelWritten = true;
      for (const [name, hex] of Object.entries(fixture.files)) {
        assert.match(name, /^[a-zA-Z0-9_.-]+$/u);
        assert.notEqual(name, "sentinel");
        await writeFile(`${cwd}/${name}`, Buffer.from(hex, "hex"));
      }
      const result = spawnSync(`${oracle}/src/${fixture.command}`, fixture.args, { argv0: `${authorArgv0Directory}/${fixture.command}`, cwd, input: Buffer.from(fixture.stdinHex, "hex"), env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.error, undefined, fixture.name);
      assert.equal(result.signal, null, fixture.name);
      assert.notEqual(result.status, null);
      const files: Record<string, string> = {};
      for (const name of Object.keys(fixture.files)) files[name] = (await readFile(`${cwd}/${name}`)).toString("hex");
      assert.deepEqual(files, fixture.files, `${fixture.name}: native input preservation`);
      assert.deepEqual((await readdir(cwd)).sort(), [...Object.keys(files), "sentinel"].sort());
      return { exitCode: result.status!, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex"), files };
    } finally {
      try {
        if (sentinelWritten) assert.equal(await readFile(`${cwd}/sentinel`, "utf8"), sentinel);
        assert.equal(dirname(cwd), parent);
      } finally { await rm(cwd, { recursive: true }); }
    }
  } finally {
    await rmdir(parent);
  }
}
export async function direct(fixture: TableCase): Promise<Row> {
  const result = await runTable(fixture);
  const files: Record<string, string> = {};
  for (const name of Object.keys(fixture.files)) files[name] = Buffer.from(await result.fs.readFile(`/work/${name}`)).toString("hex");
  assert.deepEqual(files, fixture.files);
  return { exitCode: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: Buffer.from(result.stderr).toString("hex"), files };
}
export async function shell(fixture: TableCase, pipeline: boolean): Promise<Row> {
  return product({ ...fixture, args: [...fixture.args] }, pipeline);
}
export function profileMatch(actual: Row, expected: Row): boolean {
  return actual.exitCode === expected.exitCode && actual.stdoutHex === expected.stdoutHex && Boolean(actual.stderrHex) === Boolean(expected.stderrHex) && JSON.stringify(actual.files) === JSON.stringify(expected.files);
}
