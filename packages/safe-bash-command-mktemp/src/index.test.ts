import assert from "node:assert/strict";
import test from "node:test";
import { createMktempCommand, createMktempCommands, mktempCommands } from "./index.js";
test("mktemp exports its command and plugin", () => {
  assert.equal(createMktempCommand().name, "mktemp");
  assert.equal(createMktempCommands().length, 1);
  assert.equal(mktempCommands().name, "mktemp-commands");
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";

async function run(args: string[], fs = createMemoryFileSystem(), env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createMktempCommand().execute({
    command: "mktemp", args: values.args, argumentValues: values, cwd: "/", env, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

for (const args of [[], ["-d"], ["-t", "myprefix"], ["-d", "-t", "myprefix"], ["-t", "prefixXX"]]) {
  test(`mktemp works on a fresh VFS: ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    const result = await run(args, fs);
    assert.equal(result.exitCode, 0, result.stderr);
    const path = result.stdout.trim();
    const prefix = args.includes("-t") ? args.at(-1)! : "tmp";
    assert.ok(path.startsWith(`/tmp/${prefix}.`), path);
    const stat = await fs.stat(path);
    assert.equal(stat.type, args.includes("-d") ? "directory" : "file");
    assert.equal(stat.mode & 0o777, args.includes("-d") ? 0o700 : 0o600);
  });
}

test("mktemp preserves explicit parent and dry-run behavior", async () => {
  for (const [args, env] of [ [["-p", "/missing"], {}], [[], { TMPDIR: "/missing" }], [["-p", "/tmp"], {}] ] as [string[], Record<string, string>][]) {
    const fs = createMemoryFileSystem();
    assert.equal((await run(args, fs, env)).exitCode, 1);
    await assert.rejects(fs.stat("/tmp"));
  }
  const fs = createMemoryFileSystem();
  assert.equal((await run(["-u"], fs)).exitCode, 0);
  await assert.rejects(fs.stat("/tmp"));
  assert.equal((await run(["prefix"], fs)).exitCode, 1);
  assert.equal((await run(["-t", "dir/prefix"], fs)).exitCode, 1);
});
