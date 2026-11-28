import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

test("col removes backspace overstrikes and colrm removes inclusive columns", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("printf 'ab\\bc\\n' | col -b; echo \"rc=$?\"; printf 'abcdef\\n' | colrm 2 4; echo \"rc=$?\"");
    assert.equal(result.stdout, "ac\nrc=0\naef\nrc=0\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("col -bx removes overstrikes and expands tabs in a pipeline", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("printf 'ab\\bc\\tZ\\n' | col -bx");
    assert.equal(result.stdout, "ac      Z\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const name of ["col", "colrm"] as const) test(`${name} limits supplied through agentCommands are enforced`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({
    [name]: { limits: { maxInputBytes: 2 } },
  }));
  try {
    const result = await shell.exec(`printf abc | ${name}`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /input limit exceeded/u);
  } finally { await shell.dispose(); }
});
