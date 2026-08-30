import assert from "node:assert/strict";
import test from "node:test";
import { assertBytes, cwd, exactUpdate, instrument, invoke, memory, quoted, rejectsWithoutMutation, section, snapshot } from "./helpers.js";

for (const [path, strip, target] of [
  ["a///dir//leaf", 1, "dir/leaf"], ["./leaf", 1, "leaf"], ["a/./leaf", 2, "leaf"],
  ["a/dir/./leaf", 1, "dir/leaf"], ["a///./dir//leaf", 2, "dir/leaf"],
] as const) {
  test(`GNU strip/dot semantics ${path} -p${strip}`, async () => {
    await exactUpdate(target, section(path), [`-p${strip}`]);
  });
}

for (const path of ["a/target/", "a/target//", "a/target/.", "a/target/./", "a/target/./."]) {
  for (const explicit of [false, true]) {
    test(`directory syntax cannot become regular target ${path} explicit=${explicit}`, async () => {
      const backing = await memory({ target: "old\n", first: "old\n", sentinel: "untouched\n" });
      const before = await snapshot(backing);
      const observed = instrument(backing);
      const result = await invoke(observed.fs, "patch", {
        args: explicit ? ["-p1", "target"] : ["-p1"],
        input: (explicit ? "" : section("a/first")) + section(quoted(path)),
      });
      assert.deepEqual(observed.mutations(), [], `Directory syntax must not write: ${result.stderr}`);
      assert.deepEqual(await snapshot(backing), before);
      assert([1, 2].includes(result.exitCode), `Expected non-success, got ${result.exitCode}`);
    });
  }
}

for (const [first, second] of [
  ["a/target", "a//./target"], ['"a/target"', '"a/\\164arget"'],
  ["a/dir/target", "a///dir/./target"],
] as const) {
  for (const dryRun of [false, true]) {
    test(`${dryRun ? "atomic extension " : "GNU default "}coherent normalized sequence ${first} -> ${second} dry=${dryRun}`, async () => {
      const target = first.includes("dir") ? "dir/target" : "target";
      const backing = await memory({ [target]: "old\n", first: "old\n", sentinel: "untouched\n" });
      const identity = (await backing.lstat(`${cwd}/${target}`)).ino;
      const before = await snapshot(backing);
      const observed = instrument(backing);
      const result = await invoke(observed.fs, "patch", {
        args: ["-p1", ...(dryRun ? ["--atomic", "--dry-run"] : [])],
        input: section("a/first") + section(first, first, "old", "middle") + section(second, second, "middle", "new"),
      });
      assert.equal(result.exitCode, 0, `Coherent duplicates must apply, not blanket-reject: ${result.stderr}`);
      await assertBytes(backing, target, dryRun ? "old\n" : "new\n");
      await assertBytes(backing, "first", dryRun ? "old\n" : "new\n");
      await assertBytes(backing, "sentinel", "untouched\n");
      assert.equal((await backing.lstat(`${cwd}/${target}`)).ino, identity);
      if (dryRun) {
        assert.deepEqual(observed.mutations(), []);
        assert.deepEqual(await snapshot(backing), before);
      } else {
        assert(observed.mutations().every(operation => operation.method === "writeFile" && [target, "first"].some(name => operation.path === `${cwd}/${name}`)));
      }
    });
  }
  test(`atomic extension conflicting normalized sequence is status 1 with zero early writes ${second}`, async () => {
    await rejectsWithoutMutation(section("a/first") + section(first, first, "old", "middle")
      + section(second, second, "wrong", "new"), ["--atomic", "-p1"], 1);
  });
}

for (const kind of ["final-symlink", "ancestor-symlink", "hardlink", "same-inode-two-names"] as const) {
  test(`decoded normalized alias rejection ${kind}`, async () => {
    const backing = await memory({ first: "old\n", target: "old\n", "dir/target": "old\n", sentinel: "untouched\n" });
    let alias = "alias";
    if (kind === "ancestor-symlink") { await backing.symlink("dir", `${cwd}/alias`); alias = "alias/target"; }
    else if (kind === "final-symlink") await backing.symlink("target", `${cwd}/alias`);
    else await backing.link(`${cwd}/target`, `${cwd}/alias`);
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const prefix = section("a/first") + (kind === "same-inode-two-names" ? section("a/target") : "");
    const encodedAlias = quoted(`a//./${alias}`).replace("alias", "\\141lias");
    const result = await invoke(observed.fs, "patch", { args: ["-p1"], input: prefix + section(encodedAlias) });
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
    assert.equal(result.exitCode, 2, result.stderr);
  });
}
