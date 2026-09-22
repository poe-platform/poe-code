import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { filesystem, run } from "./helpers.js";
import { Shell } from "../../../src/shell/index.js";
import { createDiffPatchCommands, diffPatchCommands } from "../../../src/commands/diff-patch/index.js";
import { createCommandArguments, toByteSource } from "../../../src/contracts/index.js";

const { fixtures } = JSON.parse(readFileSync(new URL("./diff-admitted-options.json", import.meta.url), "utf8")) as {
  fixtures: { args: string[]; old: string; next: string; expected: { exitCode: number; stdout: string; stderr: string } }[];
};

for (const fixture of fixtures) test(`GNU admitted options ${JSON.stringify(fixture.args)} ${JSON.stringify(fixture.old)}`, async () => {
  const expected = fixture.expected;
  const actual = await run("diff", [...fixture.args, "--label=LEFT", "--label=RIGHT", "old", "new"], { files: { old: fixture.old, new: fixture.next } });
  assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
});

for (const args of [["-rx", "ignore*"], ["-rX", "excludes"], ["-rS", "z"]]) test(`directory selection ${args.join(" ")}`, async () => {
  const files = { "left/ignore.txt": "old\n", "right/ignore.txt": "new\n", "left/z": "same\n", "right/z": "same\n", excludes: "ignore*\n" };
  const actual = await run("diff", [...args, "left", "right"], { files });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, "");
});

test("pagination uses a virtual pr page", async () => {
  const actual = await run("diff", ["-l", "old", "new"], { files: { old: "old\n", new: "new\n" } });
  assert.equal(actual.exitCode, 1, actual.stderr);
  assert.match(actual.stdout, /diff -l old new/);
  assert.match(actual.stdout, /Page 1/);
  assert.match(actual.stdout, /1c1\n< old\n---\n> new\n/);
  assert.ok(actual.stdout.endsWith("\f"));
});

test("pagination accounts for the emitted page once", async () => {
  const files = { old: "old\n", new: "new\n" };
  const expected = await run("diff", ["-l", "old", "new"], { files });
  const actual = await run("diff", ["-l", "old", "new"], { files, options: { maxOutputBytes: Buffer.byteLength(expected.stdout) } });
  assert.equal(actual.exitCode, 1, actual.stderr);
  assert.equal(actual.stdout, expected.stdout);
});

test("pagination replaces an owned original argument carrier", async () => {
  const fs = await filesystem({ old: "old\n", new: "new\n" });
  const argumentValues = createCommandArguments(["-l", "old", "new"]);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const diff = createDiffPatchCommands().find(command => command.name === "diff")!;
  const actual = await diff.execute({ command: "diff", args: argumentValues.args, argumentValues, fs, cwd: "/work", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write(chunk) { stdout.push(chunk.slice()); } }, stderr: { async write(chunk) { stderr.push(chunk.slice()); } } });
  assert.equal(actual.exitCode, 1, Buffer.concat(stderr).toString());
  assert.match(Buffer.concat(stdout).toString(), /diff -l old new/);
});

test("new modes respect output, work, and regex limits", async () => {
  for (const args of [["-yW999999999999999"], ["-y"], ["-e"], ["-n"], ["-DCHANGE"], ["-l"], ["-I", "a*a*a*a*b"]]) {
    const actual = await run("diff", [...args, "old", "new"], { files: { old: "a".repeat(100) + "\n", new: "b\n" }, options: { maxOutputBytes: 4, maxWork: 1000 } });
    assert.equal(actual.exitCode, 2, JSON.stringify(args));
    assert.equal(actual.stdout, "");
  }
});

test("text mode retains non UTF-8 bytes", async () => {
  const chunks: Uint8Array[] = [];
  const actual = await run("diff", ["-a", "old", "new"], { files: { old: Uint8Array.of(255, 10), new: Uint8Array.of(254, 10) }, stdout: { async write(chunk) { chunks.push(chunk.slice()); } } });
  assert.equal(actual.exitCode, 1, actual.stderr);
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat([Buffer.from("1c1\n< "), Buffer.from([255, 10]), Buffer.from("---\n> "), Buffer.from([254, 10])]));
});

test("initial-tab context output preserves the unchanged-line marker", async () => {
  const actual = await run("diff", ["-cT", "--label=LEFT", "--label=RIGHT", "old", "new"], { files: { old: "same\nold\n", new: "same\nnew\n" } });
  assert.equal(actual.exitCode, 1, actual.stderr);
  assert.equal(actual.stdout, "*** LEFT\n--- RIGHT\n***************\n*** 1,2 ****\n \tsame\n!\told\n--- 1,2 ----\n \tsame\n!\tnew\n");
});

test("Shell invokes comparison, side-by-side, and pagination modes with owned arguments", async () => {
  const fs = await filesystem({ old: "A\n", new: "a\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(diffPatchCommands());
  const same = await shell.exec("diff -i old new");
  assert.equal(same.exitCode, 0, same.stderr);
  const side = await shell.exec("diff -y old new");
  assert.equal(side.exitCode, 1, side.stderr);
  assert.equal(side.stdout, "A\t\t\t\t\t\t\t      |\ta\n");
  const page = await shell.exec("diff -l old new");
  assert.equal(page.exitCode, 1, page.stderr);
  assert.match(page.stdout, /diff -l old new/);
});
