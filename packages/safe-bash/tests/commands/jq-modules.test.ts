import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { run } from "./structured/helpers.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { jqCommand } from "../../src/commands/structured/jq.js";
import { Shell } from "../../src/shell/index.js";

async function fixture(files: Record<string, string>) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/modules", { recursive: true });
  for (const [path, source] of Object.entries(files)) await fs.writeFile(path, Buffer.from(source));
  return fs;
}

for (const option of [["-L", "modules"], ["-Lmodules"]]) test(`jq explicit module directory ${option.join(" ")}`, async () => {
  const fs = await fixture({ "/modules/audit.jq": "def audit: 42;" });
  const result = await run([...option, "-n", 'include "audit"; audit'], "", {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "42\n");
  assert.equal(result.stderr, "");
});

test("jq imports namespaces and resolves transitive includes", async () => {
  const fs = await fixture({ "/modules/audit.jq": 'include "base"; def audit: base + 1;', "/modules/base.jq": "def base: 41;" });
  const result = await run(["-L", "modules", "-n", 'import "audit" as check; check::audit'], "", {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "42\n");
});

test("jq module search uses explicit directories in order", async () => {
  const fs = await fixture({ "/modules/audit.jq": "def audit: 42;" });
  const result = await run(["-L", "absent", "-L", "modules", "-n", 'include "audit"; audit'], "", {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "42\n");
});

for (const name of ["missing", "../audit", "/audit"]) test(`jq refuses unavailable or escaping module ${name}`, async () => {
  const fs = await fixture({ "/audit.jq": "def audit: 42;" });
  const result = await run(["-L", "modules", "-n", `include ${JSON.stringify(name)}; audit`], "", {}, { fs });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "");
});

test("jq module sources share the source byte limit", async () => {
  const fs = await fixture({ "/modules/audit.jq": "def audit: 42;" });
  const result = await run(["-L", "modules", "-n", 'include "audit"; audit'], "", { limits: { maxSourceBytes: 30 } }, { fs });
  assert.equal(result.exitCode, 5);
  assert.ok(result.stderr.includes("maxSourceBytes"));
});

test("jq rejects module dependency cycles", async () => {
  const fs = await fixture({ "/modules/audit.jq": 'include "audit"; def audit: 42;' });
  const result = await run(["-L", "modules", "-n", 'include "audit"; audit'], "", {}, { fs });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "");
});

test("jq compiles every module definition and refuses executable module bodies", async () => {
  for (const source of ["def unused: missing; def audit: 42;", "def audit: 42; 99"]) {
    const fs = await fixture({ "/modules/audit.jq": source });
    const result = await run(["-L", "modules", "-n", 'include "audit"; audit'], "", {}, { fs });
    assert.equal(result.exitCode, 3);
    assert.equal(result.stdout, "");
  }
});

test("jq source-file filters can use modules and preserve lexical definitions", async () => {
  const fs = await fixture({ "/modules/audit.jq": "def base: 41; def audit: base + 1;", "/filter.jq": 'include "audit"; def base: 99; audit, base' });
  const result = await run(["-L", "modules", "-n", "-f", "filter.jq"], "", {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "42\n99\n");
});

test("jq modules execute through the actual Shell", async () => {
  const fs = await fixture({ "/modules/audit.jq": "def audit: 42;" });
  const commands = new CommandRegistry();
  commands.register(jqCommand());
  const shell = new Shell({ fs, commands });
  const result = await shell.exec(`jq -L modules -n 'include "audit"; audit'`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "42\n");
  assert.equal(result.stderr, "");
});

test("jq module definitions keep CLI variables when the caller shadows them", async () => {
  const fs = await fixture({ "/modules/audit.jq": "def audit: $item;" });
  const result = await run(["-L", "modules", "--argjson", "item", "42", "-n", 'include "audit"; reduce 99 as $item (0; audit)'], "", {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "42\n");
});

test("jq nested module filter arguments retain caller bindings across invocations", async () => {
  const fs = await fixture({
    "/modules/audit.jq": "def call(f): 99 as $item | f; def nested(f): call(f);",
  });
  const result = await run(["-L", "modules", "-nc",
    'include "audit"; 7 as $item | [nested($item), nested(8), nested($item)]'], "", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "[7,8,7]\n");
  assert.equal(result.stderr, "");
});
