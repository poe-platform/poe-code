import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createUnzipCommand, createUnzipCommands, unzipCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "") {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const fs = createMemoryFileSystem();
  // Independently generated ZIP_STORED fixture containing hello.txt.
  await fs.writeFile("/archive.zip", Uint8Array.from(atob("UEsDBBQAAAAAAAAAIVAgMDo2BgAAAAYAAAAJAAAAaGVsbG8udHh0aGVsbG8KUEsBAhQDFAAAAAAAAAAhUCAwOjYGAAAABgAAAAkAAAAAAAAAAAAAAIABAAAAAGhlbGxvLnR4dFBLBQYAAAAAAQABADcAAAAtAAAAAAA="), character => character.charCodeAt(0)));
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone unzip works with only portable filesystem and command contracts", async () => {
  assert.equal(createUnzipCommand().name, "unzip");
  assert.ok(createUnzipCommands().some(command => command.name === "unzip"));
  assert.equal(unzipCommands().name, "unzip-commands");
  const result = await run(createUnzipCommand(), ["-p", "/archive.zip", "hello.txt"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "hello\n");
});

for (const args of [["-qq", "-l"], ["-qql"], ["-q", "-q", "-l"], ["-qqv"]]) {
  test(`unzip ${args.join(" ")} lists only member rows`, async () => {
    const result = await run(createUnzipCommand(), [...args, "/archive.zip"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    const rows = result.stdout.trim().split("\n");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.trim().split(/\s+/)[0], "6");
    assert.ok(rows[0]!.endsWith("hello.txt"));
  });
}

test("unzip -ql keeps listing headers and totals without the archive banner", async () => {
  const result = await run(createUnzipCommand(), ["-ql", "/archive.zip"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim().split("\n").length, 5);
  assert.ok(result.stdout.includes("Length"));
  assert.ok(result.stdout.includes("1 file"));
  assert.ok(!result.stdout.includes("Archive:"));
});
