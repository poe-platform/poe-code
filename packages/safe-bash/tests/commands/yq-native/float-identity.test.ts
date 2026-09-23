import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";
import { Shell } from "../../../src/shell/shell.js";

for (const operation of ["tag", "type"]) {
  for (const spelling of ["7.00", "2e0", "-2.0", "-0.0", "0.00", "1.5", "7."]) {
    test(`Mike yq ${operation} preserves YAML float ${spelling}`, async () => {
      assert.deepEqual(await run([`.owned | ${operation}`], `owned: ${spelling}\n`), { status: 0, stdout: "!!float\n", stderr: "" });
    });
  }
  for (const expression of ["7.00", "2e0", "(-2.0)", "(-0.0)", "0.00", "1.5"]) {
    test(`Mike yq ${operation} preserves literal float ${expression}`, async () => {
      assert.deepEqual(await run([`${expression} | ${operation}`], "null\n"), { status: 0, stdout: "!!float\n", stderr: "" });
    });
  }
  for (const [spelling, expected] of [["7", "int"], ["-2", "int"], ["0x7", "int"], ['"7.00"', "str"], ["!!float 7.00", "float"]]) {
    test(`Mike yq ${operation} control ${spelling}`, async () => {
      assert.deepEqual(await run([`.owned | ${operation}`], `owned: ${spelling}\n`), { status: 0, stdout: `!!${expected}\n`, stderr: "" });
    });
  }
}

test("Mike yq preserves float identity through aliases and assignment", async () => {
  assert.deepEqual(await run(['.copy = .alias | .copy | tag'], "owned: &a 7.00\nalias: *a\n"), { status: 0, stdout: "!!float\n", stderr: "" });
});

test("Mike yq keeps integer expression literals integral", async () => {
  assert.deepEqual(await run(['[7, (-2), 0] | .[] | tag'], "null\n"), { status: 0, stdout: "!!int\n!!int\n!!int\n", stderr: "" });
});

test("Mike yq float tags work through Shell file input and pipelines", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/owned.yaml", new TextEncoder().encode("owned: 7.00\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    const result = await shell.exec("yq '.owned | tag' /owned.yaml");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "!!float\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});
