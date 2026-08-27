import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const candidate = "3a1025f53e502c3426ffee34eb8d8037b27c26f8";
const seal = "9fa86b2f";
const prefix = "tests/commands/metadata-stress/";
const read = (revision: string, name: string): string => execFileSync("git", ["show", `${revision}:${prefix}${name}`], { cwd: repository, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const helper = process.env.METADATA_HELPER_COPY ? readFileSync(process.env.METADATA_HELPER_COPY, "utf8") : read(candidate, "permission-profile/fixtures.ts");

function reverseQualification(name: string, source: string): string {
  let original = source.replace('import { qualifyModeFixtures } from "./permission-profile/fixtures.js";\n', "");
  if (name === "native-differential.test.ts") {
    original = original.replace('  const qualified = await qualifyModeFixtures(root, ["file", "directory"]);\n', "")
      .replace("    await qualified.setMode(name, initial);", "    await host.chmod(join(root, name), initial);");
  } else {
    original = original.replace('  const qualified = await qualifyModeFixtures(root, ["directory"]);\n', "")
      .replace('    const measured = await qualified.setMode("directory", initial);', '    await host.chmod(join(root, "directory"), initial);\n    const measured = (await host.stat(join(root, "directory"))).mode & 0o7777;');
  }
  return original;
}

test("independent seal authentication: 25 original raw files and 17 historical failure rows", () => {
  const archive = "permission-profile/classification-seal/";
  const manifest = JSON.parse(read(seal, `${archive}MANIFEST.json`));
  assert.equal(manifest.records.length, 25);
  const finalSeal = JSON.parse(read(seal, `${archive}FINAL_SEAL.json.data`));
  for (const record of manifest.records) {
    const original = read(seal, archive + record.destination);
    assert.equal(Buffer.byteLength(original), record.bytes);
    assert.equal(hash(original), record.sha256);
    assert.equal(read(candidate, archive + record.destination), original);
    assert.equal(readFileSync(path.join(repository, prefix, archive, record.destination), "utf8"), original);
    if (record.destination !== "FINAL_SEAL.json.data") assert.equal(finalSeal.files[record.destination.slice(0, -5)], record.sha256);
  }
  const raw = JSON.parse(read(seal, `${archive}raw-failure-excerpts.json.data`));
  assert.deepEqual(raw.map((entry: { start: number }) => entry.start), [30300, 30420]);
  assert.match(raw[0].text, /6755 \+2000/u);
  assert.match(raw[0].text, /expected: 1/u);
  assert.match(raw[0].text, /actual: 0/u);
  assert.doesNotMatch(raw[0].text, /4755/u);
  const rows = JSON.parse(read(seal, `${archive}results.json.data`)).observations.filter((row: { candidate: string; input?: { id: string } }) => row.candidate === "frozen" && row.input && !row.input.id.startsWith("success"));
  assert.equal(rows.length, 17);
  assert.equal(rows.filter((row: { input: { mode: string } }) => row.input.mode === "+2000").length, 1);
  assert.equal(rows.filter((row: { input: { mode: string } }) => row.input.mode === "ug+s").length, 16);
  for (const row of rows) {
    assert.equal(row.input.name, "directory");
    assert.equal(row.initialMeasured.gid, 0);
    assert.equal(row.layers.gnu.status, 1);
    assert.deepEqual(row.layers.gnu.before, row.layers.gnu.after);
    assert.equal(row.layers.node.status, 0);
    assert.equal(row.layers.realfs.status, 0);
    assert.equal(row.layers["command-memory"].status, 0);
    if (row.input.iteration !== undefined) {
      assert.match(raw[1].text, new RegExp(`iteration: ${row.input.iteration}\\b`, "u"));
      assert.equal(row.input.iteration % 24, 7);
    }
  }
  assert.equal(rows[0].input.initial, "6755");
  assert.equal(rows[0].initialMeasured.mode, "4755");
});

test("independent inverse diff preserves every original vector and assertion", () => {
  for (const name of ["native-differential.test.ts", "chmod-controls.test.ts"]) {
    const original = read(seal, name);
    const current = read(candidate, name);
    assert.equal(reverseQualification(name, current), original);
    const changed = name.startsWith("native") ? current.replace("iteration < 384", "iteration < 383") : current.replace('"+2000", ', "");
    assert.notEqual(reverseQualification(name, changed), original);
    const weakened = current.replace("assert.deepEqual(failures, []);", "assert.ok(true);").replace("assert.equal(actual.exitCode, native.exitCode,", "assert.notEqual(actual.exitCode, native.exitCode,");
    assert.notEqual(reverseQualification(name, weakened), original);
  }
  const differential = read(candidate, "native-differential.test.ts");
  const modes: string[] = JSON.parse(differential.match(/const modes = (\[[^\n]+\]);/u)![1]!);
  const masks = [0, 0o022, 0o077, 0o200];
  assert.equal(modes.length, 24);
  assert.match(differential, /const masks = \[0, 0o022, 0o077, 0o200\];/u);
  let seed = 0x6d657461;
  const transitions = Array.from({ length: 384 }, (_, iteration) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const name = iteration % 2 ? "directory" : "file";
    return { iteration, initial: (seed & 0o777).toString(8), name, argv: ["--", modes[iteration % 24], name], umask: masks[Math.floor(iteration / 24) % 4]!.toString(8) };
  });
  const controls = [0o6755, 0o3755, 0o4755, 0o1777].flatMap(initial => ["755", "0755", "00755", "=755", "u=rwx,go=rx", "a-s", "a=rwX", "u=rw", "g=rx", "o=rx", "+2000", "-6000"].map(mode => ({ initial: initial.toString(8), argv: ["--", mode, "directory"], umask: "22" })));
  const author = JSON.parse(read(candidate, "permission-profile/author-qualified-v2/vectors.json.data"));
  assert.equal(transitions.length, 384);
  assert.equal(controls.length, 48);
  assert.deepEqual(transitions, author.transitions);
  assert.deepEqual(controls, author.controls);
});

interface Entry {
  uid: number;
  gid: number;
  mode: number;
  ino: number;
  kind: "directory" | "file" | "symlink";
}

function simulatedFixture(source = helper) {
  const root = "/review/.native-independent";
  const events: Array<{ operation: string; target: string; uid?: number; gid?: number; mode?: number }> = [];
  const entries = new Map<string, Entry>([
    [root, { uid: 501, gid: 0, mode: 0o700, ino: 1, kind: "directory" }],
    [`${root}/file`, { uid: 501, gid: 0, mode: 0o600, ino: 2, kind: "file" }],
    [`${root}/directory`, { uid: 501, gid: 0, mode: 0o700, ino: 3, kind: "directory" }],
  ]);
  const controls = { clearSgid: false, failChown: false, ignoreChown: false, denyStat: false, euid: 501, egid: 20 };
  const host = {
    async realpath(target: string) { return target; },
    async lstat(target: string) {
      events.push({ operation: "lstat", target });
      if (controls.denyStat) throw Object.assign(new Error("denied"), { code: "EACCES" });
      const entry = entries.get(target);
      assert.ok(entry, target);
      const value = { ...entry };
      return { ...value, dev: 1, isDirectory: () => value.kind === "directory", isFile: () => value.kind === "file", isSymbolicLink: () => value.kind === "symlink" };
    },
    async chown(target: string, uid: number, gid: number) {
      events.push({ operation: "chown", target, uid, gid });
      if (controls.failChown) throw Object.assign(new Error("not authorized"), { code: "EPERM" });
      if (!controls.ignoreChown) Object.assign(entries.get(target)!, { uid, gid });
    },
    async chmod(target: string, mode: number) {
      events.push({ operation: "chmod", target, mode });
      entries.get(target)!.mode = controls.clearSgid ? mode & ~0o2000 : mode;
    },
  };
  const exports: { qualifyModeFixtures?: (root: string, names: string[]) => Promise<{ uid: number; gid: number; setMode(name: string, mode: number): Promise<number> }> } = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  runInNewContext(compiled, {
    exports,
    process: { getuid: () => 501, getgid: () => 20, geteuid: () => controls.euid, getegid: () => controls.egid },
    require(name: string) {
      if (name === "node:fs/promises") return host;
      if (name === "node:path") return path.posix;
      if (name === "../helpers.js") return { suiteRoot: "/review" };
      throw new Error(`unexpected helper import ${name}`);
    },
  });
  assert.ok(exports.qualifyModeFixtures);
  return { root, entries, events, controls, qualify: exports.qualifyModeFixtures };
}

test("independent helper: authorized member group before mode, exact readback after mode", async () => {
  const fixture = simulatedFixture();
  const qualified = await fixture.qualify(fixture.root, ["file", "directory"]);
  assert.deepEqual(fixture.events.filter(event => event.operation === "chown"), ["file", "directory"].map(name => ({ operation: "chown", target: `${fixture.root}/${name}`, uid: 501, gid: 20 })));
  assert.equal(qualified.uid, 501);
  assert.equal(qualified.gid, 20);
  assert.equal(await qualified.setMode("directory", 0o6755), 0o6755);
  const chmodIndex = fixture.events.findIndex(event => event.operation === "chmod");
  assert.ok(chmodIndex > fixture.events.findLastIndex(event => event.operation === "chown"));
  assert.equal(fixture.events.at(-1)?.operation, "lstat");
  assert.equal(fixture.entries.get(`${fixture.root}/directory`)!.gid, 20);
  fixture.controls.clearSgid = true;
  await assert.rejects(qualified.setMode("directory", 0o6755), /metadata permission prerequisite/u);
});

test("independent helper: ownership, symlink, namespace and identity rejection before mutation", async () => {
  for (const variant of ["foreign-file", "symlink-file", "foreign-root", "symlink-root", "effective-uid", "effective-gid", "empty", "duplicate", "traversal", "separator", "nul"]) {
    const fixture = simulatedFixture();
    let names = ["file", "directory"];
    if (variant === "foreign-file") fixture.entries.get(`${fixture.root}/directory`)!.uid = 502;
    if (variant === "symlink-file") fixture.entries.get(`${fixture.root}/directory`)!.kind = "symlink";
    if (variant === "foreign-root") fixture.entries.get(fixture.root)!.uid = 502;
    if (variant === "symlink-root") fixture.entries.get(fixture.root)!.kind = "symlink";
    if (variant === "effective-uid") fixture.controls.euid = 502;
    if (variant === "effective-gid") fixture.controls.egid = 0;
    if (variant === "empty") names = [];
    if (variant === "duplicate") names = ["file", "file"];
    if (variant === "traversal") names = ["../file"];
    if (variant === "separator") names = ["nested/file"];
    if (variant === "nul") names = ["file\0"];
    await assert.rejects(fixture.qualify(fixture.root, names), /metadata permission prerequisite/u, variant);
    assert.equal(fixture.events.filter(event => ["chown", "chmod"].includes(event.operation)).length, 0, variant);
  }
});

test("independent helper: unavailable chgrp and dishonest group readback fail explicitly", async () => {
  for (const control of ["failChown", "ignoreChown", "denyStat"] as const) {
    const fixture = simulatedFixture();
    fixture.controls[control] = true;
    await assert.rejects(fixture.qualify(fixture.root, ["file"]), /metadata permission prerequisite/u);
    assert.equal(fixture.events.some(event => event.operation === "chmod"), false);
  }
});

test("independent helper: changed entry/group/root and invalid modes cannot reach chmod", async () => {
  for (const variant of ["inode", "owner", "group", "symlink", "root", "invalid", "unqualified"]) {
    const fixture = simulatedFixture();
    const qualified = await fixture.qualify(fixture.root, ["file"]);
    if (variant === "inode") fixture.entries.get(`${fixture.root}/file`)!.ino++;
    if (variant === "owner") fixture.entries.get(`${fixture.root}/file`)!.uid++;
    if (variant === "group") fixture.entries.get(`${fixture.root}/file`)!.gid = 0;
    if (variant === "symlink") fixture.entries.get(`${fixture.root}/file`)!.kind = "symlink";
    if (variant === "root") fixture.entries.get(fixture.root)!.ino++;
    await assert.rejects(qualified.setMode(variant === "unqualified" ? "missing" : "file", variant === "invalid" ? 0o10000 : 0o6755), /metadata permission prerequisite/u, variant);
    assert.equal(fixture.events.some(event => event.operation === "chmod"), false, variant);
  }
});

function profileContracts(source: string): void {
  for (const required of [
    'assert.equal(process.platform, "darwin",', 'assert.equal(process.version, "v22.22.2",',
    'assert.equal(process.versions.uv, "1.51.0",', 'assert.equal(native.status, 1);',
    'assert.deepEqual(await metadata(directory), established);',
    'assert.equal(after.mode, BigInt(input.requested & ~0o2000), layer);',
    'assert.equal((await memory.stat("/work/directory")).mode & 0o7777, input.requested);',
    'assert.ok(error instanceof FsError);', 'assert.equal(error.code, "EACCES");',
    'assert.equal(error.path, "/work/blocked/file");', 'assert.deepEqual(await metadata(file), before);',
    'assert.deepEqual(await host.readFile(file), Buffer.from(sentinel));',
    'ctimeNs: entry.ctimeNs', 'strict GNU gap remains',
  ]) assert.ok(source.includes(required), required);
  assert.doesNotMatch(source, /\b(?:skip|todo)\s*[:(.]/u);
}

test("independent static profile guard rejects equality and typed-denial weakening; discovery is explicit", () => {
  const profile = read(candidate, "permission-profile/darwin-profile.test.ts");
  profileContracts(profile);
  for (const [before, after] of [
    ["assert.equal(native.status, 1);", "assert.equal(native.status, 0);"],
    ['assert.equal(error.code, "EACCES");', 'assert.ok(error.code);'],
    ["assert.deepEqual(await metadata(file), before);", ""],
    ["ctimeNs: entry.ctimeNs", "omittedCtime: 0"],
  ]) assert.throws(() => profileContracts(profile.replace(before!, after!)));
  const packageText = execFileSync("git", ["show", `${candidate}:package.json`], { cwd: repository, encoding: "utf8" });
  assert.ok(JSON.parse(packageText).scripts.test.includes("tests/**/*.test.ts"));
  assert.ok(profile.includes("not a portable-profile pass"));
  const documentation = read(candidate, "permission-profile/README.md");
  assert.match(documentation, /Missing profile prerequisites\s+fail explicitly/u);
  assert.match(documentation, /not OS-universal behavior or Linux acceptance/u);
});
