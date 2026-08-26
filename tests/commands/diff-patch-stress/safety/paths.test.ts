import assert from "node:assert/strict";
import test from "node:test";
import { assertBytes, bytes, creation, cwd, deletion, instrument, invoke, memory, replacement, snapshot } from "./helpers.js";

for (const [name, path] of [
  ["absolute", "/sandbox/work/target"], ["traversal", "prefix/../../target"],
  ["traversal before strip", "../target"], ["drive", "C:/target"],
  ["backslash", "prefix\\target"], ["nul", "target\0suffix"],
  ["escape", "target\u001b[2J"], ["del", "target\u007f"],
  ["carriage return", "target\r"],
] as const) {
  test(`unsafe second header leaves all identities and bytes intact: ${name}`, async () => {
    const backing = await memory({ first: "old\n", target: "old\n", sentinel: "untouched\n" });
    const before = await snapshot(backing);
    for (const args of [[], ["-p1"], ["target"], ["--dry-run"]]) {
      const observed = instrument(backing);
      const input = args.includes("target") ? replacement().replace("+++ target", `+++ ${path}`)
        : replacement("first") + replacement().replace("+++ target", `+++ ${path}`);
      const result = await invoke(observed.fs, "patch", { args, input });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(result.stdout, "");
      assert.deepEqual(observed.mutations(), []);
      assert.deepEqual(await snapshot(backing), before);
    }
  });
}

for (const name of ["café.txt", "cafe\u0301.txt", "file with spaces", "leading space ", "-flag", "%2e%2e%2ftarget", "$(touch sentinel)", "semi;colon", "name#comment", "name'quote"]) {
  test(`safe filename is literal, not decoded or evaluated: ${JSON.stringify(name)}`, async () => {
    const backing = await memory({ [name]: "old\n", sentinel: "untouched\n", target: "old\n" });
    const original = await backing.lstat(`${cwd}/${name}`);
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { input: replacement(name) });
    assert.equal(result.exitCode, 0, result.stderr);
    await assertBytes(backing, name, "new\n");
    await assertBytes(backing, "sentinel", "untouched\n");
    if (name !== "target") await assertBytes(backing, "target", "old\n");
    assert.equal((await backing.lstat(`${cwd}/${name}`)).ino, original.ino);
    assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), [["writeFile", `${cwd}/${name}`]]);
  });
}

for (const [first, second, args] of [
  ["target", "./target", []], ["dir/target", "dir/./target", []],
  ["a/target", "b/target", ["-p1"]], ["a/./target", "b/target", ["-p1"]],
] as const) test(`normalized duplicate prevalidation: ${first} + ${second}`, async () => {
  const backing = await memory({ target: "old\n", "dir/target": "old\n" });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args, input: replacement(first) + replacement(second) });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /duplicate target/u);
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});

test("timestamp fields cannot introduce a second target or escape cwd", async () => {
  const backing = await memory();
  const observed = instrument(backing);
  const input = replacement().replace("--- target", "--- ./target\t../../escape").replace("+++ target", "+++ target\t/sandbox/sentinel");
  const result = await invoke(observed.fs, "patch", { input });
  assert.equal(result.exitCode, 0, result.stderr);
  await assertBytes(backing, "target", "new\n");
  assert.deepEqual(observed.mutations().map(call => call.path), [`${cwd}/target`]);
});

for (const kind of ["final", "ancestor", "dangling", "cwd", "input", "hardlink", "directory", "file-parent", "missing-parent"] as const) {
  test(`pre-existing ${kind} alias/parent rejection leaves full namespace unchanged`, async () => {
    const backing = await memory({ first: "old\n", target: "old\n", "dir/target": "old\n", patch: replacement(), blocker: "old\n" });
    let input = replacement("first");
    let args: string[] = [];
    let working = cwd;
    if (kind === "final") { await backing.symlink("target", `${cwd}/alias`); input += replacement("alias"); }
    if (kind === "ancestor") { await backing.symlink("dir", `${cwd}/alias`); input += replacement("alias/target"); }
    if (kind === "dangling") { await backing.symlink("missing", `${cwd}/alias`); input += creation("alias"); }
    if (kind === "cwd") { await backing.symlink("work", "/sandbox/alias"); working = "/sandbox/alias"; input = replacement(); }
    if (kind === "input") { await backing.symlink("patch", `${cwd}/alias`); args = ["-i", "alias"]; }
    if (kind === "hardlink") { await backing.link(`${cwd}/target`, `${cwd}/alias`); input += deletion("alias"); }
    if (kind === "directory") input += replacement("dir");
    if (kind === "file-parent") input += creation("blocker/child");
    if (kind === "missing-parent") input += creation("missing/child");
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { input, args, cwd: working });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

test("dry-run mixed create/update/delete validates every result without mutation", async () => {
  const backing = await memory({ target: "old\n", remove: "old\n", sentinel: bytes("\ufeffcafé\r\n") });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args: ["--dry-run"], input: creation("new") + replacement() + deletion("remove") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, `checking file ${cwd}/new\nchecking file ${cwd}/target\nchecking file ${cwd}/remove\n`);
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});

for (const label of ["target\n+++ sentinel", "target\ttimestamp", "target\r", "target\0"]) {
  test(`diff rejects header-injecting label ${JSON.stringify(label)} without output`, async () => {
    const backing = await memory({ target: "old\n", desired: "new\n" });
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "diff", { args: ["--label", label, "target", "desired"] });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
  });
}
