import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

for (const flag of ["-a", "--archive"]) test(`cp ${flag} preserves metadata and hard links`, async () => {
  const fs = await fixture({ "src/file": "abc" });
  await fs.chmod("/work/src/file", 0o640);
  await fs.utimes("/work/src/file", 1000, 2000);
  await fs.link("/work/src/file", "/work/src/other");
  const result = await run("cp", [flag, "src", "dst"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  const stat = await fs.stat("/work/dst/file");
  assert.equal(stat.mode & 0o777, 0o640);
  assert.equal(stat.uid, (await fs.stat("/work/src/file")).uid);
  assert.equal(stat.gid, (await fs.stat("/work/src/file")).gid);
  assert.equal(stat.atimeMs, 1000);
  assert.equal(stat.mtimeMs, 2000);
  assert.equal(stat.ino, (await fs.stat("/work/dst/other")).ino);
});

for (const [flags, type] of [
  [["-R"], "symlink"], [["-aL"], "file"], [["-P", "-L"], "file"],
  [["-L", "-P"], "symlink"], [["-RP", "-H"], "file"], [["-aH"], "file"],
  [["--archive", "--dereference"], "file"], [["-H", "-P"], "symlink"],
  [["-La"], "symlink"], [["-P", "-S", "-L"], "symlink"],
] as const) test(`cp ${flags.join(" ")} applies symlink precedence`, async () => {
  const fs = await fixture({ file: "abc" });
  await fs.symlink("file", "/work/sym");
  const result = await run("cp", [...flags, "sym", "dst"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.lstat("/work/dst")).type, type);
});

test("cp -RH follows operand links but preserves nested links", async () => {
  const fs = await fixture({ "src/file": "abc" });
  await fs.symlink("file", "/work/src/link");
  await fs.symlink("src", "/work/operand");
  const result = await run("cp", ["-RH", "operand", "dst"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.lstat("/work/dst")).type, "directory");
  assert.equal((await fs.lstat("/work/dst/link")).type, "symlink");
});

for (const [command, args, expected] of [
  ["tail", ["+2"], "2\n3\n"], ["head", ["-q", "-2"], "1\n2\n"],
  ["tail", ["-q", "-2"], "2\n3\n"], ["head", ["-n", "-2"], "1\n"],
] as const) test(`${command} ${args.join(" ")} accepts signed and legacy counts`, async () => {
  const result = await run(command, args, { stdin: "1\n2\n3\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

for (const command of ["head", "tail"]) for (const [suffix, count] of [["b", 512], ["kB", 1000], ["K", 1024], ["M", 1048576], ["G", 1073741824]] as const) {
  test(`${command} accepts byte multiplier ${suffix}`, async () => {
    const stdin = "x".repeat(1100);
    const result = await run(command, ["-c", `1${suffix}`], { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length, Math.min(count, stdin.length));
  });
}

test("tail -10f accepts an attached follow flag", async () => {
  const result = await run("tail", ["-10f", "--max-idle=0"], { stdin: "1\n2\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1\n2\n");
});

test("head treats bare +N as a filename", async () => {
  const fs = await fixture({ "+2": "file contents" });
  const result = await run("head", ["+2"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "file contents");
});

for (const command of ["head", "tail"]) {
  for (const amount of ["1KBjunk", "9007199254740992", "9007199254740991K", "K", "+", "--2"]) {
    test(`${command} rejects invalid or overflowing count ${amount}`, async () => {
      const result = await run(command, ["-c", amount], { stdin: "abc" });
      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes("invalid number"), result.stderr);
    });
  }
  test(`${command} keeps signed option values and filenames after -- intact`, async () => {
    const fs = await fixture({ "-2": "abc", "+2": "xyz" });
    const result = await run(command, ["-c", "+2", "--", "-2", "+2"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes(command === "head" ? "ab" : "bc"), result.stdout);
    assert.ok(result.stdout.includes(command === "head" ? "xy" : "yz"), result.stdout);
  });
}
