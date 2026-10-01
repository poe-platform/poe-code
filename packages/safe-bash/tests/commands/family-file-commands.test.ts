import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, standardCommands, metadataCommands, byteCommands, createAgentCommands } from "../../src/index.js";

test("metadata and byte families install and copy files", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.txt", new TextEncoder().encode("hello world"));
  const shell = new Shell({ fs }).use(standardCommands()).use(metadataCommands()).use(byteCommands());
  t.after(() => shell.dispose());
  const installed = await shell.exec("install -D -m 644 /in.txt /nested/file");
  assert.equal(installed.exitCode, 0, installed.stderr);
  const copied = await shell.exec("dd if=/nested/file of=/out.txt bs=5 count=1");
  assert.equal(copied.exitCode, 0, copied.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/out.txt")), "hello");
});

test("aggregate registers file commands once", () => {
  const names = createAgentCommands().map(command => command.name);
  for (const name of ["install", "dd", "xan"]) assert.equal(names.filter(value => value === name).length, 1);
});
