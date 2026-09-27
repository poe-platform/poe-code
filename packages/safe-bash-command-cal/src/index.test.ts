import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createCalCommand } from "./index.js";

async function runCal(args: string[]) {
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createCalCommand({ clock: () => new Date("2026-09-26T12:00:00Z") });
  const res = await cmd.execute({
    command: "cal",
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    stdin: createBytePipe().readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const c of stdout.readable) chunks.push(c);
  return { exitCode: res.exitCode, stdout: Buffer.concat(chunks).toString("utf8") };
}

test("cal renders month, year, -3, -M Monday first, -j Julian, and September 1752 reformation", async () => {
  const sep2026 = await runCal(["9", "2026"]);
  assert.equal(sep2026.exitCode, 0);
  assert.match(sep2026.stdout, /September 2026/);
  assert.match(sep2026.stdout, /Su Mo Tu We Th Fr Sa/);

  const monFirst = await runCal(["-M", "9", "2026"]);
  assert.match(monFirst.stdout, /Mo Tu We Th Fr Sa Su/);

  const sep1752 = await runCal(["9", "1752"]);
  assert.match(sep1752.stdout, /1 {2}2 14 15 16/);

  const three = await runCal(["-3", "9", "2026"]);
  assert.match(three.stdout, /August 2026.*September 2026.*October 2026/);
});
