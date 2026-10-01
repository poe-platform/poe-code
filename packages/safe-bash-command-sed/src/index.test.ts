import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createSedCommand, createSedCommands, sedCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", fs = createMemoryFileSystem()) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone sed works with only portable filesystem and command contracts", async () => {
  assert.equal(createSedCommand().name, "sed");
  assert.ok(createSedCommands().some(command => command.name === "sed"));
  assert.equal(sedCommands().name, "sed-commands");
  const result = await run(createSedCommand(), ["s/old/new/g"], "old old\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "new new\n");
});


test("sed bounds retained program caches across distinct scripts", async (t) => {
  const caches = new Set<Map<unknown, unknown>>();
  const originalSet = Map.prototype.set;
  t.mock.method(Map.prototype, "set", function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (typeof value === "object" && value !== null && "program" in value && "steps" in value) caches.add(this);
    return originalSet.call(this, key, value);
  });
  const command = createSedCommand();
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("x\n"));
  for (let i = 0; i < 80; i++) {
    const pair = await run(command, [`s/cache${i}/x/;s/x/y/`, "/input"], "", fs);
    assert.equal(pair.exitCode, 0, pair.stderr);
    assert.equal(pair.stdout, "y\n");
    const result = await run(command, [`s/general${i}/z/`], `general${i}\n`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "z\n");
  }
  assert.ok(caches.size > 0, "program caching was exercised");
  for (const cache of caches) assert.ok(cache.size <= 64, `retained ${cache.size} programs`);
  const replay = await run(command, ["s/general0/z/"], "general0\n");
  assert.equal(replay.stdout, "z\n");
  assert.equal(replay.exitCode, 0, replay.stderr);
});


test("sed shares byte-oriented programs between file and stdin execution", async () => {
  const command = createSedCommand();
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("café\n"));
  for (const args of [["s/café/tea/;s/tea/done/", "/input"], ["s/café/tea/;s/tea/done/"]]) {
    const result = await run(command, args, "café\n", fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "done\n");
  }
});
