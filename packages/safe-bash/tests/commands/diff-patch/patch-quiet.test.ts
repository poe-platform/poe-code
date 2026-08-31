import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { contents, filesystem, native, replacement, run, type Files } from "./helpers.js";
import { oracleIdentity, pins } from "../diff-patch-stress/gnu-target/oracle.js";
import { nativeGnuBinding } from "../../native-profile.js";

const parent = "tests/commands/diff-patch";
const twoHunks = replacement + "@@ -3 +3 @@\n-tail\n+TAIL\n";

async function namespace(fs: FileSystem) {
  const files: Record<string, string> = {};
  const directories: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await fs.readdir(`/work/${relative}`)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === "directory") { directories.push(path); await visit(path); }
      else {
        assert.equal(entry.type, "file");
        files[path] = await contents(fs, path);
      }
    }
  };
  await visit("");
  return { files, directories: directories.sort(), rootExists: true };
}

test("quiet native controls use the frozen GNU patch 2.8 executable", context => {
  const identity = oracleIdentity("patch");
  const path = process.env.DIFF_PATCH_NATIVE_PATCH;
  const expected = nativeGnuBinding("patch", path === undefined ? {} : { path }) ?? pins.gnu.patch;
  assert.equal(identity.sha256, expected.sha256);
  assert.match(identity.version, /^GNU patch 2\.8\n/u);
  context.diagnostic(JSON.stringify(identity));
});

interface Fixture { name: string; files: Files; input: string; args?: readonly string[]; diagnostic?: RegExp }
const fixtures: readonly Fixture[] = [
  { name: "apply", files: { target: "old\n" }, input: replacement },
  { name: "reverse", files: { target: "new\n" }, input: replacement, args: ["-R"] },
  { name: "dry-run", files: { target: "old\n" }, input: replacement, args: ["--dry-run"] },
  { name: "multifile", files: { target: "old\n", second: "old\n" }, input: replacement + replacement.replaceAll("target", "second") },
  { name: "offset and backup", files: { target: "prefix\nold\n" }, input: replacement },
  { name: "fuzz and backup", files: { target: "different\nold\nlast\n" }, input: "--- target\n+++ target\n@@ -1,3 +1,3 @@\n first\n-old\n+new\n last\n" },
  { name: "failed hunk and reject", files: { target: "wrong\n" }, input: replacement, diagnostic: /1 out of 1 hunk FAILED -- saving rejects to file target\.rej\n/u },
  { name: "failed dry-run", files: { target: "wrong\n" }, input: replacement, args: ["--dry-run"], diagnostic: /1 out of 1 hunk FAILED\n/u },
  { name: "partial hunk publication", files: { target: "old\nkeep\nwrong\n" }, input: twoHunks, diagnostic: /1 out of 2 hunks FAILED/u },
  { name: "explicit reject destination", files: { target: "wrong\n" }, input: replacement, args: ["-r", "rejects"], diagnostic: /saving rejects to file rejects/u },
  { name: "automatic reversal warning", files: { target: "new\n" }, input: replacement, diagnostic: /Reversed \(or previously applied\) patch detected! {2}Assuming -R\./u },
];

for (const fixture of fixtures) {
  for (const quiet of [false, true]) {
    test(`${quiet ? "quiet" : "default"} matches pinned native bytes/effects: ${fixture.name}`, async context => {
      const args = ["-t", "-p0", ...(quiet ? ["-s"] : []), ...(fixture.args ?? [])];
      const expected = await native("patch", args, fixture.files, fixture.input, { parent });
      context.diagnostic(JSON.stringify({ args, input: fixture.input, files: fixture.files, expected }));
      const actual = await run("patch", args, { files: fixture.files, input: fixture.input });
      assert.equal(actual.exitCode, expected.exitCode);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.deepEqual(await namespace(actual.fs), { files: expected.files, directories: expected.directories, rootExists: expected.rootExists });
      if (fixture.diagnostic) assert.match(actual.stdout, fixture.diagnostic);
      if (quiet) assert.doesNotMatch(actual.stdout, /^(?:patching|checking) file |^Hunk #/mu);
      else assert.match(actual.stdout, /^(?:patching|checking) file target\n/u);
    });
  }
}

for (const quiet of [false, true]) {
  test(`${quiet ? "quiet retains" : "default matches GNU"} deletion-conflict diagnostic`, async context => {
    const files = { target: "old\nextra\n" };
    const input = "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
    const args = ["-t", "-p0", ...(quiet ? ["-s"] : [])];
    const expected = await native("patch", args, files, input, { parent });
    const actual = await run("patch", args, { files, input });
    context.diagnostic(JSON.stringify({ input, files, expected, productStdout: actual.stdout, exactNativeOutput: !quiet }));
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.equal(actual.stderr, expected.stderr);
    assert.deepEqual(await namespace(actual.fs), { files: expected.files, directories: expected.directories, rootExists: expected.rootExists });
    const warning = "Not deleting file target as content differs from patch\n";
    assert.equal(actual.stdout, quiet ? warning : `patching file target\n${warning}`);
    assert.equal(expected.stdout, quiet ? "" : actual.stdout);
  });
}

for (const args of [["--quiet"], ["--silent"], ["-stp0"], ["-sRp0"]]) {
  test(`quiet aliases/grouped options ${args.join(" ")}`, async () => {
    const files = { target: args.includes("-sRp0") ? "new\n" : "old\n" };
    const expected = await native("patch", args, files, replacement, { parent });
    const actual = await run("patch", args, { files, input: replacement });
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stdout, "");
    assert.equal(actual.stderr, "");
    assert.equal(expected.exitCode, actual.exitCode);
    assert.equal(expected.stdout, actual.stdout);
    assert.equal(expected.stderr, actual.stderr);
    assert.deepEqual((await namespace(actual.fs)).files, expected.files);
  });
}

for (const input of ["--- target\n+++ target\n@@ -1 +1 @@\n?bad\n", replacement + "--- second\n+++ second\n@@ -1 +1 @@\n?bad\n"]) {
  test(`quiet retains malformed diagnostics and committed prefix (${input.length} bytes)`, async context => {
    const files = { target: "old\n", second: "old\n" };
    const regular = await run("patch", ["-p0"], { files, input });
    const quiet = await run("patch", ["-s", "-p0"], { files, input });
    const expected = await native("patch", ["-s", "-t", "-p0"], files, input, { parent });
    context.diagnostic(JSON.stringify({ input, expected, productStderr: quiet.stderr }));
    assert.equal(quiet.exitCode, 2);
    assert.equal(quiet.exitCode, regular.exitCode);
    assert.equal(quiet.exitCode, expected.exitCode);
    assert.equal(quiet.stdout, "");
    assert.equal(expected.stdout, "");
    assert.equal(quiet.stderr, regular.stderr);
    assert.match(quiet.stderr, /malformed/u);
    assert.match(expected.stderr, /malformed/u);
    assert.deepEqual(await namespace(quiet.fs), await namespace(regular.fs));
    assert.deepEqual((await namespace(quiet.fs)).files, expected.files);
  });
}

for (const atomic of [false, true]) {
  test(`quiet success never writes routine stdout (atomic=${atomic})`, async () => {
    const result = await run("patch", ["-s", ...(atomic ? ["--atomic"] : [])], {
      files: { target: "old\n" }, input: replacement,
      stdout: { write() { throw new Error("quiet success must not touch stdout"); } },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "new\n");
  });

  test(`quiet preserves failure diagnostics and effects (atomic=${atomic})`, async () => {
    const options = { files: { target: "wrong\n" }, input: replacement };
    const args = atomic ? ["--atomic"] : [];
    const regular = await run("patch", args, options);
    const quiet = await run("patch", ["-s", ...args], options);
    assert.equal(quiet.exitCode, regular.exitCode);
    assert.equal(quiet.exitCode, 1);
    assert.equal(quiet.stderr, regular.stderr);
    assert.match(quiet.stdout + quiet.stderr, atomic ? /hunk 1 does not match/u : /1 out of 1 hunk FAILED/u);
    assert.deepEqual(await namespace(quiet.fs), await namespace(regular.fs));
  });
}

test("quiet retains path, symlink, hardlink and input-alias guards", async () => {
  const fs = await filesystem({ target: "old\n", change: replacement });
  await fs.symlink("target", "/work/symbolic");
  await fs.link("/work/target", "/work/hard");
  for (const target of ["../outside", "symbolic", "hard", "change"]) {
    const options = { fs, input: replacement.replaceAll("target", target) };
    const args = target === "change" ? ["-i", "change", "change"] : ["-p0"];
    const regular = await run("patch", args, options);
    const quiet = await run("patch", ["-s", ...args], options);
    assert.equal(quiet.exitCode, 2);
    assert.equal(quiet.stderr, regular.stderr);
    assert.notEqual(quiet.stderr, "");
    assert.equal(quiet.stdout, "");
  }
  assert.equal(await contents(fs, "target"), "old\n");
  assert.equal(await contents(fs, "hard"), "old\n");
  assert.equal(await contents(fs, "change"), replacement);
  assert.equal(await fs.readlink("/work/symbolic"), "target");
});

test("quiet does not relax input, output, work or line limits", async () => {
  for (const options of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }, { maxWork: 1 }, { maxLines: 1 }]) {
    const result = await run("patch", ["-s"], { files: { target: "old\n" }, input: replacement, options });
    assert.equal(result.exitCode, 2);
    assert.notEqual(result.stderr, "");
    assert.equal(await contents(result.fs, "target"), "old\n");
  }
});

test("quiet reports publication failure and preserves the completed prefix", async () => {
  const fs = await filesystem({ target: "old\n", second: "old\n" });
  const write = fs.writeFile.bind(fs);
  fs.writeFile = async (path, data, options) => {
    if (path === "/work/second") throw new FsError("ENOSPC", { path });
    return write(path, data, options);
  };
  const result = await run("patch", ["-s"], { fs, input: replacement + replacement.replaceAll("target", "second") });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /1\/2 files committed.*side effects.*\/work\/second/u);
  assert.equal(await contents(fs, "target"), "new\n");
  assert.equal(await contents(fs, "second"), "old\n");
});

test("quiet propagates pre-aborted cancellation without effects", async () => {
  const fs = await filesystem({ target: "old\n" });
  const controller = new AbortController();
  const reason = new Error("quiet pre-abort");
  controller.abort(reason);
  await assert.rejects(run("patch", ["-s"], { fs, input: replacement, signal: controller.signal }), error => error === reason);
  assert.equal(await contents(fs, "target"), "old\n");
});

test("quiet aborts blocked input and observes its late rejection", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("quiet input abort");
  let rejectRead: ((error: Error) => void) | undefined;
  let returned = false;
  const input: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((_resolve, reject) => { rejectRead = reject; }),
        return: async () => { returned = true; return { done: true, value: undefined }; },
      };
    },
  };
  const pending = run("patch", ["-s"], { input, signal: controller.signal });
  await delay(10);
  assert(rejectRead);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  rejectRead(new Error("late quiet read failure"));
  await delay(10);
  assert.equal(returned, true);
});

test("quiet failure summaries remain cancellable before publication", { timeout: 2000 }, async () => {
  const fs = await filesystem({ target: "wrong\n" });
  const controller = new AbortController();
  const reason = new Error("quiet diagnostic abort");
  let rejectWrite: ((error: Error) => void) | undefined;
  const pending = run("patch", ["-s"], {
    fs, input: replacement, signal: controller.signal,
    stdout: { write: () => new Promise((_resolve, reject) => { rejectWrite = reject; }) },
  });
  await delay(10);
  assert(rejectWrite);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  rejectWrite(new Error("late quiet diagnostic failure"));
  await delay(10);
  assert.equal(await contents(fs, "target"), "wrong\n");
  assert.deepEqual(await namespace(fs), { files: { target: "wrong\n" }, directories: [], rootExists: true });
});
