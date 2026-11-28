import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { agentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/index.js";

test("ls long-format ownership variants work through shell pipelines", async context => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("touch a; ls -n a | awk '{print NF}'; ls -g a | awk '{print NF}'; ls -o a | awk '{print NF}'; ls -lG a | awk '{print NF}'");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "9\n8\n8\n8\n");
});

for (const [flags, ownership] of [
  ["-n", ["123", "456"]], ["-g", ["456"]], ["-o", ["123"]],
  ["-lG", ["123"]], ["-Gl", ["123"]], ["-go", []],
  ["-gn", ["456"]], ["-on", ["123"]], ["-gGl", []], ["-n1", ["123", "456"]],
] as const) test(`ls selects ownership columns with ${flags}`, async () => {
  const fs = await fixture({ a: "" });
  const lstat = fs.lstat.bind(fs);
  fs.lstat = async (...args) => ({ ...await lstat(...args), uid: 123, gid: 456 });
  const result = await run("ls", [flags, "a"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const fields = result.stdout.trim().split(/\s+/u);
  assert.equal(fields.length, 7 + ownership.length);
  assert.deepEqual(fields.slice(2, 2 + ownership.length), ownership);
  assert.equal(fields.at(-1), "a");
});

for (const flags of ["-G", "-nC", "-gm", "-ox"]) {
  test(`ls ownership selectors preserve subsequent layout with ${flags}`, async () => {
    const result = await run("ls", [flags, "a"], { fs: await fixture({ a: "" }) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "a\n");
  });
}

for (const [flags, expected] of [
  [["-m"], "a, b, c\n"], [["-x"], "a  b  c\n"], [["-C"], "a  b  c\n"],
  [["-w", "1"], "a\nb\nc\n"], [["--format=commas"], "a, b, c\n"],
  [["--format=single-column"], "a\nb\nc\n"],
  [["-Cw4"], "a  c\nb\n"], [["-x", "--width=4"], "a  b\nc\n"],
  [["-m", "-w4"], "a,\nb, c\n"], [["-m", "-w0"], "a, b, c\n"],
  [["-lC"], "a  b  c\n"], [["-m1"], "a\nb\nc\n"],
  [["--format", "vertical"], "a  b  c\n"], [["--format=horizontal"], "a  b  c\n"],
  [["--format=across"], "a  b  c\n"], [["--format=commas", "--format=single-column"], "a\nb\nc\n"],
] as const) test(`ls output layout: ${flags.join(" ")}`, async () => {
  const result = await run("ls", flags, { fs: await fixture({ a: "", b: "", c: "" }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("ls layout selectors work through the shell and pipeline", async () => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("touch a b c; ls -m; ls -x; ls -C; ls -w 1; ls --format=commas; ls --format=single-column; ls --format=long | wc -l");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "a, b, c\na  b  c\na  b  c\na\nb\nc\na, b, c\na\nb\nc\n4\n");
});

for (const flags of [["--format=long"], ["--format=verbose"], ["-Cl"], ["--format=long", "-1"]]) {
  test(`ls long layout: ${flags.join(" ")}`, async () => {
    const result = await run("ls", flags, { fs: await fixture({ a: "" }) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.startsWith("total 0\n-rw-"), result.stdout);
    assert.ok(result.stdout.endsWith(" a\n"), result.stdout);
  });
}

for (const flags of [["-w"], ["-w-1"], ["--width=no"], ["--format"], ["--format=unknown"]]) {
  test(`ls rejects invalid layout options: ${flags.join(" ")}`, async () => {
    const result = await run("ls", flags);
    assert.equal(result.exitCode, 2);
    assert.notEqual(result.stderr, "");
    assert.equal(result.stdout, "");
  });
}

test("ls groups file operands and keeps directory layouts separate", async () => {
  const result = await run("ls", ["-m", "b", "a", "dir"], { fs: await fixture({ a: "", b: "", "dir/c": "", "dir/d": "" }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "a, b\n\ndir:\nc, d\n");
});

test("ls layouts preserve quoting, indicators, recursion and empty directories", async () => {
  const fs = await fixture({ "dir/a": "", "dir/b": "" });
  await fs.mkdir("/work/empty");
  const result = await run("ls", ["-mQpR"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '".":\n"dir"/, "empty"/\n\n"./dir":\n"a", "b"\n\n"./empty":\n');
});

test("ls layout parsing preserves -- operands", async () => {
  const fs = await fixture({ "-w": "", "--format=commas": "" });
  const result = await run("ls", ["-m", "--", "-w", "--format=commas"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "--format=commas, -w\n");
  const long = await run("ls", ["-l", "--", "-w"], { fs });
  assert.equal(long.exitCode, 0, long.stderr);
  assert.ok(long.stdout.startsWith("-rw-"), long.stdout);
});

for (const [flags, expected] of [
  [["-a", "-A"], ".hidden\nfile\n"],
  [["-aA"], ".hidden\nfile\n"],
  [["--all", "--almost-all"], ".hidden\nfile\n"],
  [["-A", "-a"], ".\n..\n.hidden\nfile\n"],
  [["-Aa"], ".\n..\n.hidden\nfile\n"],
  [["--almost-all", "--all"], ".\n..\n.hidden\nfile\n"],
] as const) test(`ls uses the last hidden-entry selector: ${flags.join(" ")}`, async () => {
  const result = await run("ls", flags, { fs: await fixture({ file: "", ".hidden": "" }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("ls ignores option-shaped operands after --", async () => {
  const result = await run("ls", ["-a", "--", "-A"], { fs: await fixture({ "-A/file": "" }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, ".\n..\nfile\n");
});

for (const flags of [["-l", "-1"], ["-l1"], ["-1l"], ["-l", "-1", "-c"]]) {
  test(`ls retains GNU long format with ${flags.join(" ")}`, async () => {
    const result = await run("ls", [...flags, "file"], { fs: await fixture({ file: "" }) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.startsWith("-rw-"), result.stdout);
    assert.ok(result.stdout.endsWith(" file\n"), result.stdout);
  });
}

for (const operand of ["/work///", "./tree///", "tree/", "tree///"]) {
  test(`ls strips trailing separators from recursive child headers: ${operand}`, async () => {
    const fs = await fixture({ "tree/sub/file": "" });
    const root = operand.startsWith("/work") ? "/work" : operand.startsWith(".") ? "./tree" : "tree";
    const result = await run("ls", ["-R", operand], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, operand.startsWith("/work")
      ? `${operand}:\ntree\n\n${root}/tree:\nsub\n\n${root}/tree/sub:\nfile\n`
      : `${operand}:\nsub\n\n${root}/sub:\nfile\n`);
  });
}
