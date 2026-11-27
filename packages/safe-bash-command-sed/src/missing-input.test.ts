import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createSedCommand } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", fs: FileSystem = createMemoryFileSystem(), env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env,
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

for (const flags of [[], ["-s"], ["-z"]]) {
  test(`sed continues past missing input files with ${flags.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    const separator = flags.includes("-z") ? "\0" : "\n";
    await fs.writeFile("/f", Buffer.from(`a${separator}`));
    await fs.writeFile("/g", Buffer.from(`b${separator}`));
    const result = await run(createSedCommand(), [...flags, "-n", "p", "f", "nofile", "g"], "", fs);
    assert.equal(result.stdout, `a${separator}b${separator}`);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "sed: can't read nofile: No such file or directory\n");
  });
}

for (const suffix of ["", ".bak"]) {
  test(`sed in-place continues past missing input with suffix ${suffix}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/f", Buffer.from("a\n"));
    const result = await run(createSedCommand(), [`-i${suffix}`, "s/a/X/", "nofile", "f"], "", fs);
    assert.equal(Buffer.from(await fs.readFile("/f")).toString(), "X\n");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "sed: can't read nofile: No such file or directory\n");
    if (suffix) assert.equal(Buffer.from(await fs.readFile("/f.bak")).toString(), "a\n");
  });
}

test("sed preserves cross-file state while skipping missing inputs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f", Buffer.from("a\n"));
  await fs.writeFile("/g", Buffer.from("b\n"));
  const result = await run(createSedCommand(), ["N;s/\\n/-/", "f", "nofile", "g"], "", fs);
  assert.equal(result.stdout, "a-b\n");
  assert.equal(result.exitCode, 2);
});

for (const flags of [[], ["-s"], ["-z"], ["-i"]]) {
  test(`sed reports every missing operand with ${flags.join(" ")}`, async () => {
    const result = await run(createSedCommand(), [...flags, "p", "missing", "absent/file"]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "sed: can't read missing: No such file or directory\nsed: can't read absent/file: No such file or directory\n");
  });
}

test("sed quit does not read later missing inputs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f", Buffer.from("a\n"));
  const result = await run(createSedCommand(), ["q", "f", "nofile"], "", fs);
  assert.equal(result.stdout, "a\n");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
});
