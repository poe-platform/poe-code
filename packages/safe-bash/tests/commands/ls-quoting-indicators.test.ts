import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands } from "../../src/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

// Expected bytes captured from GNU ls with LC_ALL=C; all fixtures stay in memory.
for (const flag of ["--quote-name", "-Q"]) {
  test(`ls ${flag} quotes filenames with C byte escapes`, async () => {
    const cases = [
      ["input", '"input"\n'], ["bell\x07", '"bell\\a"\n'], ["a\"b", '"a\\"b"\n'],
      ["back\\slash", '"back\\\\slash"\n'], ["line\nname", '"line\\nname"\n'],
      ["tab\tname", '"tab\\tname"\n'], ["é", '"\\303\\251"\n'],
    ] as const;
    for (const [name, expected] of cases) {
      const result = await run("ls", [flag, "-1", name], { fs: await fixture({ [name]: "a" }) });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Buffer.from(expected));
    }
  });
}

for (const [style, expected] of [
  ["none", "exe\nfile\nlink\nsub\n"],
  ["slash", "exe\nfile\nlink\nsub/\n"],
  ["file-type", "exe\nfile\nlink@\nsub/\n"],
  ["classify", "exe*\nfile\nlink@\nsub/\n"],
] as const) {
  for (const args of [[`--indicator-style=${style}`], ["--indicator-style", style]]) {
    test(`ls ${args.join(" ")} renders VFS entry indicators`, async () => {
      const fs = await fixture({ exe: "a", file: "a" });
      await fs.chmod("/work/exe", 0o755);
      await fs.mkdir("/work/sub");
      await fs.symlink("file", "/work/link");
      const result = await run("ls", [...args, "-1"], { fs });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Buffer.from(expected));
    });
  }
}

test("ls reproduces quoted files and slash directory indicators through Shell and agentCommands", async context => {
  const fs = await fixture({ input: "a" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  for (const [source, expected] of [
    ["ls --quote-name -1 input", '"input"\n'],
    ["mkdir sub; ls --indicator-style=slash -1 -d sub", "sub/\n"],
  ] as const) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});

for (const [args, suffix] of [
  [["-F", "--indicator-style=none"], ""],
  [["--indicator-style=none", "-F"], "/"],
  [["--classify", "--indicator-style=none"], ""],
  [["--indicator-style=none", "--classify"], "/"],
  [["-Fp", "--indicator-style=none"], ""],
  [["--indicator-style=none", "-pF"], "/"],
] as const) {
  test(`ls indicator precedence: ${args.join(" ")}`, async () => {
    const fs = await fixture();
    await fs.mkdir("/work/sub");
    const result = await run("ls", [...args, "-Qd", "sub"], { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `"sub"${suffix}\n`);
  });
}

test("ls quotes long symlink targets and recursive directory headers", async () => {
  const fs = await fixture({ 'dir name/a"b': "a" });
  await fs.symlink('a"b', "/work/dir name/link");
  const link = await run("ls", ["--quote-name", "-l", "dir name/link"], { fs });
  assert.equal(link.exitCode, 0);
  assert.ok(link.stdout.endsWith(' "dir name/link" -> "a\\"b"\n'));
  const recursive = await run("ls", ["-QR", "dir name"], { fs });
  assert.equal(recursive.exitCode, 0);
  assert.equal(recursive.stdout, '"dir name":\n"a\\"b"\n"link"\n');
});

test("ls respects -- when option-shaped filenames are operands", async () => {
  const fs = await fixture({ "--quote-name": "a", "--indicator-style=slash": "a" });
  const result = await run("ls", ["--", "--quote-name", "--indicator-style=slash"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "--indicator-style=slash\n--quote-name\n");
});

test("ls accepts unambiguous indicator style prefixes and rejects invalid styles before listing", async () => {
  const fs = await fixture({ input: "a" });
  for (const prefix of ["n", "s", "f", "c"]) {
    assert.equal((await run("ls", [`--indicator-style=${prefix}`, "input"], { fs })).exitCode, 0);
  }
  for (const style of ["", "unknown"]) {
    const result = await run("ls", [`--indicator-style=${style}`, "input"], { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `ls: ${style ? "invalid" : "ambiguous"} argument '${style}' for '--indicator-style'\nValid arguments are:\n  - 'none'\n  - 'slash'\n  - 'file-type'\n  - 'classify'\nTry 'ls --help' for more information.\n`);
  }
  const missing = await run("ls", ["--indicator-style"], { fs });
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.stdout, "");
});

for (const [style, directorySuffix, executableSuffix] of [
  ["none", "", ""], ["slash", "", ""], ["file-type", "/", ""], ["classify", "/", "*"],
] as const) {
  test(`ls --indicator-style=${style} preserves operand symlink and long target semantics`, async () => {
    const fs = await fixture({ "sub/child": "a", exe: "a" });
    await fs.chmod("/work/exe", 0o755);
    await fs.symlink("sub", "/work/linkdir");
    await fs.symlink("exe", "/work/linkexe");
    await fs.symlink("missing", "/work/dangling");
    const operand = await run("ls", [`--indicator-style=${style}`, "linkdir"], { fs });
    assert.equal(operand.exitCode, 0);
    assert.equal(operand.stdout, style === "classify" ? "linkdir@\n" : "child\n");
    for (const [link, target] of [["linkdir", `sub${directorySuffix}`], ["linkexe", `exe${executableSuffix}`], ["dangling", "missing"]] as const) {
      const result = await run("ls", ["-Ql", `--indicator-style=${style}`, link], { fs });
      assert.equal(result.exitCode, 0);
      const targetName = target.endsWith("/") || target.endsWith("*") ? `"${target.slice(0, -1)}"${target.slice(-1)}` : `"${target}"`;
      assert.ok(result.stdout.endsWith(` "${link}" -> ${targetName}\n`), result.stdout);
    }
  });
}
