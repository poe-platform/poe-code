import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createLocaleCommand } from "./index.js";

async function runLocale(args: string[], env: Record<string, string> = {}) {
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createLocaleCommand();
  const res = await cmd.execute({
    command: "locale",
    args: createCommandArguments(args).args,
    cwd: "/",
    env,
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

test("locale prints active categories, supported locales (-a), charmaps (-m), and keyword queries", async () => {
  const def = await runLocale([], { LANG: "C.UTF-8", LC_CTYPE: "C" });
  assert.match(def.stdout, /LANG=C\.UTF-8/);
  assert.match(def.stdout, /LC_CTYPE=C\n/);
  assert.match(def.stdout, /LC_NUMERIC="C\.UTF-8"/);

  const all = await runLocale(["-a"]);
  assert.match(all.stdout, /C\.UTF-8/);
  assert.match(all.stdout, /POSIX/);

  assert.equal((await runLocale(["charmap"], { LC_ALL: "C" })).stdout, "ANSI_X3.4-1968\n");
  assert.equal((await runLocale(["charmap"], { LC_ALL: "C.UTF-8" })).stdout, "UTF-8\n");
  assert.equal((await runLocale(["-k", "charmap"], { LC_ALL: "C.UTF-8" })).stdout, 'charmap="UTF-8"\n');
});
