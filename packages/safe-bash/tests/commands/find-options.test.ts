import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

for (const predicate of ["-name", "-iname"]) test(`find ${predicate} treats all-slash roots as /`, async () => {
  const result = await run("find", ["///", "-maxdepth", "0", predicate, "/"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "///\n");
});

for (const [size, expected] of [["0G", "empty\n"], ["1G", "odd\neven\n"], ["1w", "even\n"], ["+1w", "odd\n"], ["-1w", "empty\n"]] as const) {
  test(`find -size ${size} rounds sizes in the requested unit`, async () => {
    const fs = await fixture({ empty: "", odd: "abc", even: "ab" });
    const result = await run("find", ["empty", "odd", "even", "-size", size], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

for (const root of ["./", ".///", "././"]) test(`find ${root} -delete preserves the current directory`, async () => {
  const fs = await fixture({ "sub/file": "" });
  const result = await run("find", [root, "-delete"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readdir("/work"), []);
});

for (const [args, expected] of [
  [["--", "dir", "-name", "file.txt"], "dir/sub/file.txt\n"],
  [["-L", "--", "dir", "-name", "sub"], "dir/sub\n"],
  [["dir", "-maxdepth", "1", "-a", "-name", "sub"], "dir/sub\n"],
  [["dir", "-name", "sub", "-a", "-depth"], "dir/sub\n"],
  [["dir", "(", "-maxdepth", "0", ")"], "dir\n"],
  [["dir", "!", "-mindepth", "1"], ""],
  [["dir", "-false", "-o", "-maxdepth", "0"], "dir\n"],
  [["dir", "-false", "-a", "-maxdepth", "0", "-o", "-true"], "dir\n"],
  [["dir//", "-name", "sub"], "dir/sub\n"],
  [["dir////", "-wholename", "dir/sub"], "dir/sub\n"],
  [["dir", "-iwholename", "DIR/SUB"], "dir/sub\n"],
  [["dir", "-type", "f,d"], "dir\ndir/sub\ndir/sub/file.txt\n"],
  [["dir", "-type", "b,p,s"], ""],
  [["dir", "-name", "-depth", "-o", "-name", "sub"], "dir/sub\n"],
] as const) test(`find preserves expression semantics: ${args.join(" ")}`, async () => {
  const fs = await fixture({ "dir/sub/file.txt": "" });
  const result = await run("find", args, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

for (const [predicate, operand, expected] of [
  ["-perm", "640", "file\n"], ["-perm", "u=rw,g=r", "file\n"],
  ["-perm", "-600", "file\n"], ["-perm", "/111", ""],
  ["-perm", "/400", "file\n"], ["-perm", "/000", "file\n"],
  ["-perm", "600", ""], ["-links", "2", "file\n"],
  ["-links", "+1", "file\n"], ["-links", "-3", "file\n"],
  ["-links", "1", ""],
] as const) test(`find ${predicate} ${operand} matches metadata`, async () => {
  const fs = await fixture({ file: "" });
  await fs.chmod("/work/file", 0o640);
  await fs.link("/work/file", "/work/alias");
  const result = await run("find", ["file", predicate, operand], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

for (const args of [["-maxdepth", "-1"], ["-mindepth"], ["-perm", "888"], ["-links", "1.5"], ["-type", "f,"], ["-type", "ff"]]) {
  test(`find validates before actions: ${args.join(" ")}`, async () => {
    const fs = await fixture({ keep: "" });
    const result = await run("find", ["keep", "-delete", ...args], { fs });
    assert.equal(result.exitCode, 2);
    assert.ok(await fs.lstat("/work/keep"));
  });
}

for (const [type, mode] of [["b", 0o060000], ["p", 0o010000], ["s", 0o140000]] as const) {
  test(`find -type ${type} inspects special-file mode bits`, async context => {
    const fs = await fixture({ special: "" });
    const stat = await fs.lstat("/work/special");
    context.mock.method(fs, "lstat", async () => ({ ...stat, mode: mode | 0o640 }));
    const result = await run("find", ["special", "-type", type], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "special\n");
  });
}

test("find -links reports unavailable metadata instead of guessing", async context => {
  const fs = await fixture({ file: "" });
  const { nlink: _nlink, ...stat } = await fs.lstat("/work/file");
  context.mock.method(fs, "lstat", async () => stat);
  const result = await run("find", ["file", "-links", "1"], { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("link count unavailable"));
});
