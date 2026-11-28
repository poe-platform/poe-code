import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type FileSystem } from "safe-bash-contracts";
import { createTarCommand } from "./index.js";

async function run(fs: FileSystem, args: string[], env: Record<string, string>) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createTarCommand().execute({
    command: "tar", args: values.args, argumentValues: values, cwd: "/", env, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

for (const hostZone of ["America/Chicago", "Asia/Tokyo"]) {
  for (const [label, env, input, expected] of [
    ["default UTC", {}, "2020-01-02 03:04:05", "2020-01-02 03:04:05"],
    ["explicit UTC", { TZ: "UTC" }, "2020-01-02 03:04:05", "2020-01-02 03:04:05"],
    ["shell timezone", { TZ: "America/New_York" }, "2020-01-02 03:04:05", "2020-01-02 08:04:05"],
    ["daylight saving time", { TZ: "America/New_York" }, "2020-07-02 03:04:05", "2020-07-02 07:04:05"],
    ["date only", { TZ: "Asia/Kolkata" }, "2020-01-02", "2020-01-01 18:30:00"],
    ["explicit Z", { TZ: "America/New_York" }, "2020-01-02T03:04:05Z", "2020-01-02 03:04:05"],
    ["explicit offset", { TZ: "America/New_York" }, "2020-01-02T03:04:05+02:00", "2020-01-02 01:04:05"],
    ["epoch seconds", { TZ: "America/New_York" }, "@1577934245", "2020-01-02 03:04:05"],
  ] as const) {
    test(`tar --mtime uses ${label} on host ${hostZone}`, async t => {
      const prior = process.env.TZ;
      process.env.TZ = hostZone;
      t.after(() => { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; });
      const fs = createMemoryFileSystem();
      await fs.writeFile("/a", new TextEncoder().encode("hi\n"));
      assert.deepEqual(await run(fs, ["cf", "t.tar", `--mtime=${input}`, "a"], env),
        { exitCode: 0, stdout: "", stderr: "" });
      const listed = await run(fs, ["tvf", "t.tar"], env);
      assert.equal(listed.exitCode, 0, listed.stderr);
      assert.equal(listed.stderr, "");
      assert.equal(listed.stdout.trimEnd().split(" ").filter(Boolean).slice(3, 5).join(" "), expected.slice(0, 16));
      const full = await run(fs, ["tvf", "t.tar", "--full-time"], env);
      assert.equal(full.exitCode, 0, full.stderr);
      assert.ok(full.stdout.includes(expected), full.stdout);
      await fs.mkdir("/extracted");
      assert.equal((await run(fs, ["xf", "t.tar", "-C", "/extracted"], env)).exitCode, 0);
      assert.equal((await fs.stat("/extracted/a")).mtimeMs, Date.parse(expected.replace(" ", "T") + "Z"));
    });
  }
}

for (const input of ["", " ", "@", "not-a-date", "@Infinity"]) {
  test(`tar rejects invalid --mtime=${input} before replacing an archive`, async () => {
    const fs = createMemoryFileSystem();
    const original = new TextEncoder().encode("keep this archive");
    await fs.writeFile("/t.tar", original);
    const result = await run(fs, ["cf", "t.tar", `--mtime=${input}`, "a"], {});
    assert.deepEqual(result, { exitCode: 2, stdout: "", stderr: `tar: invalid mtime: ${input}\n` });
    assert.deepEqual(await fs.readFile("/t.tar"), original);
  });
}
