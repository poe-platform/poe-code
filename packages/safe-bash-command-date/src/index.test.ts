import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createDateCommand } from "./index.js";

test("date help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createDateCommand().execute({
  command: "date", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

async function run(args: string[], fs = createMemoryFileSystem(), env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createDateCommand().execute({
    command: "date", args: values.args, argumentValues: values, cwd: "/", env, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

import { FsError } from "safe-bash-contracts";
import { evalSyncDate } from "./date.js";

for (const [args, expected] of [
  [["-u", "-r", "1700000000", "+%F"], "2023-11-14\n"],
  [["-u", "-r", "-0.25", "+%s.%N"], "-1.750000000\n"],
  [["-uj", "-r", "1700000000", "-v+1d", "+%F"], "2023-11-15\n"],
  [["-u", "-d", "2024-01-31", "-v+1m", "+%F"], "2024-02-29\n"],
  [["-u", "-d", "2024-02-29", "-v+1y", "+%F"], "2025-02-28\n"],
  [["-u", "-d", "2024-01-15", "-v1d", "-v+1m", "-v-1d", "+%F"], "2024-01-31\n"],
  [["-u", "-d", "2024-01-15", "-v+1w", "-v+2H", "-v+3M", "-v+4S", "+%F %T"], "2024-01-22 02:03:04\n"],
  [["-u", "-d", "2024-01-15", "-v2025y", "-v2m", "-v1d", "-v12H", "-v30M", "-v45S", "+%F %T"], "2025-02-01 12:30:45\n"],
  [["-u", "-d", "2024-01-15", "-v0w", "+%F"], "2024-01-14\n"],
] as [string[], string][]) {
  test(`BSD date ${args.join(" ")}`, async () => {
    assert.deepEqual(await run(args), { exitCode: 0, stdout: expected, stderr: "" });
    assert.equal(evalSyncDate(args, undefined, undefined, undefined, () => undefined), args.includes("-r") ? undefined : expected);
  });
}

test("date reference files take priority and only ENOENT permits epoch fallback", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/1700000000", new Uint8Array());
  const expected = `${Math.floor((await fs.stat("/1700000000")).mtimeMs / 1000)}\n`;
  assert.equal((await run(["-r", "1700000000", "+%s"], fs)).stdout, expected);
  assert.equal((await run(["--reference", "1700000001", "+%s"], fs)).exitCode, 1);
  const denied = new Proxy(fs, { get(target, key) {
    if (key === "stat") return async () => { throw new FsError("EACCES"); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await run(["-r", "1700000001"], denied)).exitCode, 1);
  for (const value of ["1e3", "1.", "NaN", " 100", "missing"]) assert.equal((await run(["-r", value])).exitCode, 1);
  for (const value of ["+1q", "1.5d", "32d", "13m", "24H", "60M", "60S", "7w", "99999999999999999y", ""]) {
    assert.equal((await run(["-v", value])).exitCode, 1, value);
  }
});

for (const [reference, adjustment, expected] of [
  ["1709969400", "+1d", "2024-03-10 03:30:00 -0400\n"],
  ["1730525400", "+1d", "2024-11-03 01:30:00 -0400\n"],
  ["1700000000", "25y", "2025-11-14 17:13:20 -0500\n"],
  ["1700000000", "125y", "2025-11-14 17:13:20 -0500\n"],
  ["1700000000", "69y", "1969-11-14 17:13:20 -0500\n"],
] as const) {
  test(`BSD calendar adjustment handles ${reference} ${adjustment}`, async () => {
    const args = ["-r", reference, "-v" + adjustment, "+%F %T %z"];
    const env = { TZ: "America/New_York" };
    assert.deepEqual(await run(args, createMemoryFileSystem(), env), { exitCode: 0, stdout: expected, stderr: "" });
    assert.equal(evalSyncDate(args, env.TZ, undefined, undefined, () => undefined), args.includes("-r") ? undefined : expected);
  });
}
