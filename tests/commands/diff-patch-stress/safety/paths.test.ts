import assert from "node:assert/strict";
import test from "node:test";
import { assertDefaultParity } from "../gnu-target-followup/evidence.js";
import { missingParentProbes } from "../gnu-target-followup/fixtures.js";
import { assertBytes, bytes, creation, cwd, deletion, instrument, invoke, memory, replacement, snapshot } from "./helpers.js";

for (const [name, path] of [
  ["absolute", "/sandbox/work/decoy"], ["traversal", "prefix/../../target"],
  ["traversal before strip", "../target"], ["drive", "C:/target"],
  ["backslash", "prefix\\target"], ["nul", "target\0suffix"],
  ["escape", "target\u001b[2J"], ["del", "target\u007f"],
  ["carriage return", "target\r"],
] as const) {
  test(name === "absolute" ? "absolute headers reject automatic selection but explicit target wins without changing decoys"
    : `unsafe second header leaves all identities and bytes intact: ${name}`, async () => {
    for (const args of [[], ["-p1"], ["target"], ["--dry-run"]]) {
      const backing = await memory({ first: "old\n", target: "old\n", decoy: "old\n", sentinel: "untouched\n" });
      const before = await snapshot(backing);
      const observed = instrument(backing);
      const input = args.includes("target") ? replacement("first").replace("+++ first", `+++ ${path}`)
        : replacement("first") + replacement().replace("+++ target", `+++ ${path}`);
      const result = await invoke(observed.fs, "patch", { args, input });
      if (name === "absolute" && args.includes("target")) {
        const expected = before.map(entry => {
          assert(typeof entry === "object" && entry !== null && "path" in entry);
          return entry.path === `${cwd}/target` ? { ...entry, data: Buffer.from("new\n").toString("hex") } : entry;
        });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "patching file target\n");
        await assertBytes(backing, "target", "new\n");
        assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), [["writeFile", `${cwd}/target`]]);
        assert.deepEqual(await snapshot(backing), expected, "Only explicit target bytes change; all identities and decoy header targets remain intact");
        continue;
      }
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

const normalizedTargets = [
  ["target", "./target", []], ["dir/target", "dir/./target", ["-p0"]],
  ["a/target", "b/target", ["-p1"]], ["a/./target", "b/target", ["-p1"]],
] as const;

for (const [first, second, args] of normalizedTargets) for (const reverse of [false, true]) for (const dryRun of [false, true]) {
  test(`atomic extension single-final-write normalized sequence: ${first} + ${second}, reverse=${reverse}, dryRun=${dryRun}`, async () => {
    const target = first.startsWith("dir/") ? "dir/target" : "target";
    const initial = reverse ? "final\n" : "old\n";
    const backing = await memory({ [target]: initial, sentinel: "untouched\n" });
    const before = await snapshot(backing);
    const identity = await backing.lstat(`${cwd}/${target}`);
    const observed = instrument(backing);
    const input = replacement(first) + replacement(second).replace("-old\n+new\n", "-new\n+final\n");
    const result = await invoke(observed.fs, "patch", { args: ["--atomic", ...args, ...(reverse ? ["-R"] : []), ...(dryRun ? ["--dry-run"] : [])], input });
    assert.equal(result.exitCode, 0, result.stderr);
    await assertBytes(backing, target, dryRun ? initial : reverse ? "old\n" : "final\n");
    await assertBytes(backing, "sentinel", "untouched\n");
    assert.equal((await backing.lstat(`${cwd}/${target}`)).ino, identity.ino);
    assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), dryRun ? [] : [["writeFile", `${cwd}/${target}`]]);
    if (dryRun) assert.deepEqual(await snapshot(backing), before);
  });
}

for (const [first, second, args] of normalizedTargets) test(`atomic extension --force contradictory normalized sequence prevalidation: ${first} + ${second}`, async () => {
  const backing = await memory({ target: "old\n", "dir/target": "old\n" });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args: ["--atomic", "--force", ...args], input: replacement(first) + replacement(second) });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stderr, /hunk .* does not match/u);
  assert.equal(result.stdout, "");
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

for (const kind of ["final", "ancestor", "dangling", "cwd", "input", "hardlink", "directory", "file-parent"] as const) {
  test(`pre-existing ${kind} alias/parent rejection leaves full namespace unchanged`, async () => {
    const backing = await memory({ first: "old\n", target: "old\n", "dir/target": "old\n", patch: replacement(), blocker: "old\n" });
    let input = replacement("first");
    let args: string[] = [];
    let working = cwd;
    if (kind === "final") { await backing.symlink("target", `${cwd}/alias`); input += replacement("alias"); }
    if (kind === "ancestor") { await backing.symlink("dir", `${cwd}/alias`); input += replacement("alias/target"); args = ["-p0"]; }
    if (kind === "dangling") { await backing.symlink("missing", `${cwd}/alias`); input += creation("alias"); }
    if (kind === "cwd") { await backing.symlink("work", "/sandbox/alias"); working = "/sandbox/alias"; input = replacement(); }
    if (kind === "input") { await backing.symlink("patch", `${cwd}/alias`); args = ["-i", "alias"]; }
    if (kind === "hardlink") { await backing.link(`${cwd}/target`, `${cwd}/alias`); input += deletion("alias"); }
    if (kind === "directory") input += replacement("dir");
    if (kind === "file-parent") { input += creation("blocker/child"); args = ["-p0"]; }
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { input, args, cwd: working });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

for (const probe of missingParentProbes) test(`GNU default creation and complete namespace: ${probe.id}`, async () => {
  await assertDefaultParity(probe);
});

test("dry-run mixed create/update/delete validates every result without mutation", async () => {
  const backing = await memory({ target: "old\n", remove: "old\n", sentinel: bytes("\ufeffcafé\r\n") });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args: ["--dry-run"], input: creation("new") + replacement() + deletion("remove") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "checking file new\nchecking file target\nchecking file remove\n");
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
