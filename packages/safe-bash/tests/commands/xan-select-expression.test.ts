import assert from "node:assert/strict";
import { test } from "node:test";
import { createXanCommands, xanCommands } from "../../src/commands/xan/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

for (const [selector, data, stdout] of [
  ['"2024"', "id,2024\nx,99\n", "2024\n99\n"],
  ['"0"', "id,0\nx,99\n", "0\n99\n"],
  ['"a""b"', '"a""b",c\n1,2\n', '"a""b"\n1\n'],
  ['"a""b"[1]', '"a""b","a""b"\n1,2\n', '"a""b"\n2\n'],
  ['"0":"2024"', "id,0,2024\nx,1,2\n", "0,2024\n1,2\n"],
  ["0", "id,0\nx,99\n", "id\nx\n"],
] as const) test(`xan select preserves quoted names: ${selector}`, async () => {
  const result = await run("xan", ["select", selector, "data"], {
    fs: await fixture({ data }), commands: createXanCommands(),
  });
  assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, stdout, ""]);
});

for (const flag of ["--evaluate", "-e", "--evaluate-file", "-f"]) {
  test(`xan select accepts ${flag} named-column expression`, async () => {
    const fs = await fixture({ data: "name,n\nAda,1\nGrace,2\n", expr: "name\n" });
    const result = await run("xan", ["select", flag, flag.endsWith("file") || flag === "-f" ? "expr" : "name", "data"], { fs, commands: createXanCommands() });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "name\nAda\nGrace\n");
    assert.equal(result.stderr, "");
  });
}

test("expression flags run through the Shell plugin and retain literal/slice controls", async () => {
  const fs = await fixture({ data: 'name,n\n"Ada",1\nGrace,2\n', expr: "name" });
  const shell = new Shell({ fs, cwd: "/work" }).use(xanCommands());
  for (const command of ["xan select -e name data", "xan select -f expr data", "xan select --evaluate name data", "xan select --evaluate-file expr data"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "name\nAda\nGrace\n");
  }
  assert.equal((await shell.exec("xan select 0 data")).stdout, 'name\n"Ada"\nGrace\n');
  assert.equal((await shell.exec("xan slice -e 1 data")).stdout, "name,n\nAda,1\n");
  await shell.dispose();
});

for (const specimen of [
  { args: ["-e", "-f", "expr", "data"], error: "conflicting expression modes" },
  { args: ["-f", "missing", "data"], error: "missing" },
  { args: ["-f", "invalid", "data"], error: "not valid UTF-8" },
]) {
  test(`expression input errors: ${specimen.error}`, async () => {
    const fs = await fixture({ data: "name\nAda\n", invalid: Uint8Array.of(255) });
    const result = await run("xan", ["select", ...specimen.args], { fs, commands: createXanCommands() });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(specimen.error), result.stderr);
    assert.equal(result.stdout, "");
  });
}

test("expression file obeys selector byte budget before output publication", async () => {
  const fs = await fixture({ expr: "name", data: "name\nAda\n", output: "keep" });
  const result = await run("xan", ["select", "-f", "expr", "data", "-o", "output"], { fs, commands: createXanCommands({ limits: { maxSelectorBytes: 3 } }) });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /maxSelectorBytes/);
  assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), "keep");
});

for (const expression of ["0", "!name", "name*", "name:n", "upper(name)", "name,n"]) {
  test(`xan expression refuses unsupported syntax ${expression}`, async () => {
    const result = await run("xan", ["select", "-e", expression, "missing"], { commands: createXanCommands() });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /expression syntax/);
    assert.equal(result.stdout, "");
  });
}
