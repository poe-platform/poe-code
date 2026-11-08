import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";

async function run(args: string[], limits = {}) {
  const fs = createMemoryFileSystem();
  for (const [path, xml] of Object.entries({ "/a.xml": "<root><item>A</item></root>", "/b.xml": "<root><item>B</item></root>", "/bad.xml": "<root>" })) await fs.writeFile(path, new TextEncoder().encode(xml));
  const signal = new AbortController().signal;
  let output = "", errors = "";
  const context: CommandContext = {
    command: "xmllint", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal,
    stdin: toByteSource("<root/>"),
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } }
  };
  const result = await createXmllintCommand({ limits }).execute(context);
  assert.equal(getEventListeners(signal, "abort").length, 0);
  return { ...result, output, errors, fs };
}

for (const flags of [["--noout"], ["--format"]]) {
  test(`multiple XML files support XPath with ${flags[0]}`, async () => {
    const result = await run([...flags, "--xpath", "//item/text()", "/a.xml", "/b.xml"]);
    assert.equal(result.exitCode, 0, result.errors);
    assert.equal(result.output, "A\nB\n");
  });
}

test("multiple XML files share the input budget", async () => {
  const result = await run(["--noout", "/a.xml", "/b.xml"], { maxInputBytes: 30 });
  assert.equal(result.exitCode, 5);
  assert.match(result.errors, /maxInputBytes/);
});

test("XML validation continues after a malformed file", async () => {
  const result = await run(["--xpath", "//item/text()", "/bad.xml", "/b.xml"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.output, "B\n");
});

for (const flag of ["-o", "--output"]) {
  test(`multiple documents support ${flag} without cumulative allocation padding`, async () => {
    const result = await run(["--c14n", flag, "/out.xml", "/a.xml", "/b.xml"]);
    assert.equal(result.exitCode, 0, result.errors);
    assert.equal(result.output, "");
    assert.equal(new TextDecoder().decode(await result.fs.readFile("/out.xml")), "<root><item>B</item></root>");
  });
}

for (const [flag, expected] of [
  ["--noout", ""],
  ["--format", '<?xml version="1.0"?>\n<root>\n  <item>A</item>\n</root>\n<?xml version="1.0"?>\n<root>\n  <item>B</item>\n</root>\n'],
] as const) {
  test(`multiple XML files support standalone ${flag} in operand order`, async () => {
    const result = await run([flag, "/a.xml", "/b.xml"]);
    assert.equal(result.exitCode, 0, result.errors);
    assert.equal(result.errors, "");
    assert.equal(result.output, expected);
  });
}

test("multi-file validation checks later operands", async () => {
  const result = await run(["--noout", "/a.xml", "/bad.xml"]);
  assert.equal(result.exitCode, 1);
  assert.notEqual(result.errors, "");
  assert.equal(result.output, "");
});
