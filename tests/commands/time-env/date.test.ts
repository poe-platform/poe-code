import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { dateCases } from "./date-cases.js";
import { run } from "./helpers.js";

test("date default current time falls within the surrounding wall-clock samples", async () => {
  const before = Math.floor(Date.now() / 1000);
  const result = await run("date", ["-u", "+%s"]);
  const after = Math.floor(Date.now() / 1000);
  assert.equal(result.exitCode, 0);
  assert.ok(Number(result.stdout.trim()) >= before && Number(result.stdout.trim()) <= after);
});

for (const specimen of dateCases) {
  test(`date vector: ${specimen.name}`, async () => {
    const actual = await run("date", specimen.args, { clock: () => { throw new Error("absolute input must not read clock"); } }, { env: { ...specimen.env } });
    assert.equal(actual.stdout, specimen.stdout);
    assert.equal(actual.stderr, ""); assert.equal(actual.exitCode, 0);
  });
}

test("date injected clock is read once and only provides millisecond precision", async () => {
  let calls = 0;
  const result = await run("date", ["+%s %N %F %T %Z"], { clock: () => { calls++; return 1709210096123; } });
  assert.equal(result.stdout, "1709210096 123000000 2024-02-29 12:34:56 UTC\n");
  assert.equal(calls, 1);
  assert.equal((await run("date", [], { clock: () => 0 })).stdout, "Thu Jan  1 00:00:00 UTC 1970\n");
});

for (const [text, expected] of [["now", "2024-03-10 12:00:00"], ["today", "2024-03-10 12:00:00"], ["yesterday", "2024-03-09 12:00:00"],
  ["tomorrow", "2024-03-11 12:00:00"], ["now -1 hour", "2024-03-10 11:00:00"], ["2 minutes ago", "2024-03-10 11:58:00"], ["+3 seconds", "2024-03-10 12:00:03"]]) {
  test(`date explicit relative grammar: ${text}`, async () => {
    const result = await run("date", ["-d", text!, "+%F %T"], { clock: () => 1710086400000 }, { env: { TZ: "America/New_York" } });
    assert.equal(result.stdout, expected + "\n"); assert.equal(result.exitCode, 0);
  });
}

test("date DST gaps and ambiguous folds require an explicit offset rather than a guessed occurrence", async () => {
  for (const value of ["2024-03-10 02:30:00", "2024-11-03 01:30:00"]) {
    const result = await run("date", ["-d", value, "+%s"], {}, { env: { TZ: "America/New_York" } });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /nonexistent|ambiguous/);
  }
  assert.equal((await run("date", ["-d2024-11-03T01:30:00-04:00", "+%s"])).stdout, "1730611800\n");
  assert.equal((await run("date", ["-d2024-11-03T01:30:00-05:00", "+%s"])).stdout, "1730615400\n");
});

test("date uses only an own virtual TZ and ignores locale environment under its explicit C profile", async () => {
  const inherited = Object.create({ TZ: "Asia/Kolkata" }) as Record<string, string>;
  inherited.LC_ALL = "fr_FR.UTF-8";
  assert.equal((await run("date", ["-d@0", "+%T %Z %A"], {}, { env: inherited })).stdout, "00:00:00 UTC Thursday\n");
  assert.equal((await run("date", ["-d@0", "+%T %z"], { defaultTimeZone: "Asia/Kolkata" })).stdout, "05:30:00 +0530\n");
  assert.equal((await run("date", ["-d@0", "+%T %z"], { defaultTimeZone: "Asia/Kolkata" }, { env: { TZ: "" } })).stdout, "00:00:00 +0000\n");
});

test("date reference reads VFS mtime through a symlink, preserves bytes and never uses the injected clock", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work"); await fs.writeFile("/work/file", Buffer.from("sentinel\0雪"));
  await fs.symlink!("file", "/work/link"); await fs.utimes!("/work/file", 123, -1250);
  const before = await fs.stat("/work/file");
  const result = await run("date", ["-r", "link", "+%s %N %F %T"], { clock: () => { throw new Error("clock unused"); } }, { fs, cwd: "/work" });
  assert.equal(result.stdout, "-2 750000000 1969-12-31 23:59:58\n");
  assert.deepEqual(await fs.stat("/work/file"), before);
  assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "sentinel\0雪");
  const missing = await run("date", ["--reference=missing"], {}, { fs });
  assert.equal(missing.exitCode, 1); assert.equal(missing.stdout, ""); assert.match(missing.stderr, /no such file/);
});

for (const args of [
  ["-d2023-02-29"], ["-d1900-02-29"], ["-d2024-13-01"], ["-d2024-04-31"], ["-d2024-01-00"],
  ["-d2024-02-29T24:00:00Z"], ["-d2024-02-29T23:59:60Z"], ["-d2024-01-01T00:00:00+25:00"],
  ["-d@0.1234567890"], ["-d@NaN"], ["-d@1e3"], ["-d@99999999999999999"], ["-d"], ["--date="],
  ["--date", "next Friday"], ["--date", "01/02/03"], ["--date", "Fri, 29 Feb 2024 12:34:56 GMT"],
  ["-s", "2024-01-01"], ["--set=2024-01-01"], ["082712002026"], ["--file=/etc/passwd"],
  ["--debug"], ["--utc=yes"], ["-r", "file", "-d@0"], ["-I", "+%s"], ["-Iinvalid"], ["--rfc-3339=hours"],
  ["-d@0", "+%Q"], ["-d@0", "+%"], ["-d@0", "+%::::z"], ["-d@0", "+%12N"], ["-d@0", "+%-N"],
  ["-d@0", "+%5%"],
]) {
  test(`date rejects unsupported/invalid input without stdout: ${args.join(" ")}`, async () => {
    const result = await run("date", args);
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.notEqual(result.stderr, "");
  });
}

test("date rejects invalid clocks and bounded format expansion without writing stdout", async () => {
  for (const clock of [() => NaN, () => Infinity, () => 8640000000000001]) {
    const result = await run("date", ["+%s"], { clock });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  }
  let writes = 0;
  await assert.rejects(run("date", ["-d@0", "+%999999999Y"], {}, { stdout: { async write() { writes++; } } }), { code: "EFBIG" });
  await assert.rejects(run("date", ["-d@0", "+%F"], { limits: { maxOutputBytes: 4 } }), { code: "EFBIG" });
  assert.equal(writes, 0);
});
