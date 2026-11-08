import assert from "node:assert/strict";
import test from "node:test";
import { createStatCommand, createStatCommands, statCommands } from "./index.js";
test("stat exports its command and plugin", () => {
  assert.equal(createStatCommand().name, "stat");
  assert.equal(createStatCommands().length, 1);
  assert.equal(statCommands().name, "stat-commands");
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";

async function run(args: string[], fs = createMemoryFileSystem(), env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createStatCommand().execute({
    command: "stat", args: values.args, argumentValues: values, cwd: "/", env, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

import { evalSyncStat } from "./command.js";

test("BSD stat renders metadata without changing GNU formats", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("hello"), { mode: 0o640 });
  const stat = await fs.lstat("/file");
  const format = "%z %N %m %a %c %B %Lp %Sp %u %Su %g %Sg %i %l %HT %%";
  const expected = `5 /file ${Math.floor(stat.mtimeMs / 1000)} ${Math.floor(stat.atimeMs! / 1000)} ${Math.floor(stat.ctimeMs! / 1000)} ${Math.floor(stat.birthtimeMs! / 1000)} 640 -rw-r----- 0 root 0 root ${stat.ino} ${stat.nlink} Regular File %\n`;
  assert.deepEqual(await run(["-f", format, "/file"], fs), { exitCode: 0, stdout: expected, stderr: "" });
  assert.equal(evalSyncStat(["-f", format, "/file"], "/", undefined, () => stat), expected);
  assert.equal((await run(["-c", "%s %n", "/file"], fs)).stdout, "5 /file\n");
  for (const option of ["--format=%T", "--printf=%T", "-c%T"]) {
    assert.equal((await run(["-f", option, "/file"], fs)).stdout, option.startsWith("--printf") ? "memory" : "memory\n");
  }
  assert.equal((await run(["-f", "/file"], fs)).stdout, (await run(["--file-system", "/file"], fs)).stdout);
});

test("BSD stat exposes raw symlink targets and obeys dereference", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("hello"));
  await fs.symlink!("file", "/link");
  assert.equal((await run(["-f", "%N %Y %HT", "/link"], fs)).stdout, "/link file Symbolic Link\n");
  assert.equal((await run(["-L", "-f", "%z %Y %HT", "/link"], fs)).stdout, "5  Regular File\n");
});


test("GNU stat supports epoch precision, block units, virtual identities and mount root", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("hello"));
  const stat = { ...await fs.lstat("/file"), atimeMs: -1, mtimeMs: 1700000000123.456, ctimeMs: 1234, birthtimeMs: 0 };
  const supplied = new Proxy(fs, { get(target, property) {
    if (property === "lstat") return async () => stat;
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  for (const [format, expected] of [
    ["%.9X|%.X|%.9Y|%.Y|%.9Z|%.Z|%.9W|%.W|%.12Y", "-0.001000000|-0.001000000|1700000000.123456000|1700000000.123456000|1.234000000|1.234000000|0.000000000|0.000000000|1700000000.123456000000"],
    ["%B|%U:%G|%m", "512|root:root|/"],
    [String.raw`\"%s\"`, '"5"'],
  ]) {
    const args = ["--printf", format!, "/file"];
    assert.deepEqual(await run(args, supplied), { exitCode: 0, stdout: expected, stderr: "" });
    assert.equal(evalSyncStat(args, "/", undefined, () => stat), expected);
  }
  for (const format of ["%.Y", "%.9Y"]) {
    assert.deepEqual(await run(["-c", format, "/file"], supplied), { exitCode: 0, stdout: "1700000000.123456000\n", stderr: "" });
  }
});
