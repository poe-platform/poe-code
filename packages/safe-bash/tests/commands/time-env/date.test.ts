import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { dateCases } from "./date-cases.js";
import { run } from "./helpers.js";

for (const [input, expected] of [
  ["2024-02-29t12:34:56z", "2024-02-29 12:34:56"],
  ["2024-02-29 12:34:56z", "2024-02-29 12:34:56"],
  ["2024-2-9", "2024-02-09 00:00:00"],
  ["20240229", "2024-02-29 00:00:00"],
  ["2024-01-05 1 day ago", "2024-01-04 00:00:00"],
  ["2024-01-05 +2 weeks", "2024-01-19 00:00:00"],
  ["2024-01-31 1 month", "2024-03-02 00:00:00"],
  ["2024-02-29 1 year", "2025-03-01 00:00:00"],
  ["2024-01-05 2 months ago", "2023-11-05 00:00:00"],
  ["2024-01-05 -2 years", "2022-01-05 00:00:00"],
]) {
  test(`date additional absolute and anchored relative grammar: ${input}`, async () => {
    const result = await run("date", ["-u", "-d", input!, "+%F %T"], { clock: () => { throw new Error("absolute input must not read clock"); } });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, expected + "\n");
  });
}

for (const [input, expected] of [
  ["1 day ago", "2024-02-28"], ["+2 days", "2024-03-02"], ["1 week ago", "2024-02-22"],
  ["-7 days", "2024-02-22"], ["1 week", "2024-03-07"], ["2 weeks ago", "2024-02-15"],
  ["now +2 weeks", "2024-03-14"], ["1 month", "2024-03-29"], ["1 year ago", "2023-03-01"],
]) {
  test(`date calendar offsets from injected clock: ${input}`, async () => {
    let calls = 0;
    const result = await run("date", ["-u", "-d", input!, "+%F %T %N"], { clock: () => { calls++; return 1709210096123; } });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected + " 12:34:56 123000000\n"); assert.equal(calls, 1);
  });
}

test("date calendar offsets preserve wall time across DST and explicit source offsets", async () => {
  const result = await run("date", ["-d", "2024-03-09 12:00:00 1 day", "+%F %T %z"], {}, { env: { TZ: "America/New_York" } });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "2024-03-10 12:00:00 -0400\n");
  const explicit = await run("date", ["-u", "-d", "2024-03-09t23:30:00.123456789-05:00 1 day", "+%F %T %N"]);
  assert.equal(explicit.exitCode, 0); assert.equal(explicit.stdout, "2024-03-11 04:30:00 123456789\n");
});

for (const input of ["20230229", "2024-2-30", "2024-13-9", "2024-01-31 999999999999999 days", "9999-12-31 1 year", "invalid 1 day"]) {
  test(`date rejects invalid extended grammar: ${input}`, async () => {
    const result = await run("date", ["-d", input]);
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.notEqual(result.stderr, "");
  });
}

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

test("date %12N zero-padding at epoch matches the accepted GNU9.7 profile", async () => {
  const stderr: Uint8Array[] = [];
  const result = await run("date", ["-d@0", "+%12N"], {}, { stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "000000000000\n");
  assert.equal(result.stdoutHex, "3030303030303030303030300a");
  assert.equal(result.stderr, "");
  assert.equal(Buffer.concat(stderr).toString(), "");
  assert.deepEqual(Buffer.concat(stderr), Buffer.alloc(0));
});

test("date bare %-N at epoch matches the GNU Darwin six-digit profile", async () => {
  const stderr: Uint8Array[] = [];
  const result = await run("date", ["-d@0", "+%-N"], {}, { stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "000000\n");
  assert.equal(result.stdoutHex, "3030303030300a");
  assert.equal(result.stderr, "");
  assert.equal(Buffer.concat(stderr).toString(), "");
  assert.deepEqual(Buffer.concat(stderr), Buffer.alloc(0));
});

// Fresh GNU coreutils 9.12/Darwin oracle: bare %-N uses six digits,
// while explicit widths and repeated flags use ordinary fraction formatting.
for (const [input, expected] of [
  ["@1.5", "500000000|500000|5        |5|5|5"],
  ["@1.05", "050000000|050000|05       |05|05|05"],
  ["@1.000001", "000001000|000001|000001   |0|000001|000001"],
  ["@1.123456789", "123456789|123456|123456789|123|123456|123456789"],
  ["@1.123400000", "123400000|123400|1234     |123|1234|1234"],
]) {
  test(`date GNU Darwin bare nanoseconds and ordinary width controls: ${input}`, async () => {
    const result = await run("date", ["-u", "-d", input!, "+%N|%-N|%_N|%-3N|%-6N|%-12N"]);
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected + "\n");
  });
}

for (const args of [
  ["-d2023-02-29"], ["-d1900-02-29"], ["-d2024-13-01"], ["-d2024-04-31"], ["-d2024-01-00"],
  ["-d2024-02-29T24:00:00Z"], ["-d2024-02-29T23:59:60Z"], ["-d2024-01-01T00:00:00+25:00"],
  ["-d@NaN"], ["-d@1e3"], ["-d@99999999999999999"], ["-d"],
  ["--date", "next Friday"], ["--date", "01/02/03"], ["--date", "Fri, 29 Feb 2024 12:34:56 GMT"],
  ["-s", "2024-01-01"], ["--set=2024-01-01"], ["082712002026"], ["--file=/etc/passwd"],
  ["--debug"], ["--utc=yes"], ["-r", "file", "-d@0"], ["-I", "+%s"], ["-Iinvalid"], ["--rfc-3339=hours"],
  ["-d@0", "+%Q"], ["-d@0", "+%"], ["-d@0", "+%::::z"],
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
  await assert.rejects(run("date", ["-d@0", "+%999999999Y"], { limits: { maxFormatWidth: 4096 } }, { stdout: { async write() { writes++; } } }), { code: "EFBIG" });
  await assert.rejects(run("date", ["-d@0", "+%F"], { limits: { maxOutputBytes: 4 } }), { code: "EFBIG" });
  assert.equal(writes, 0);
});

test("date file options read each VFS line through cwd and symlinks", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("2025-01-02T03:04:05Z\n2000-02-29"));
  await fs.symlink!("input", "/work/link");
  for (const args of [["-f", "link"], ["-flink"], ["--file=link"], ["--file", "link"]]) {
    const result = await run("date", [...args, "+%s"], { clock: () => { throw new Error("clock unused"); } }, { fs, cwd: "/work" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1735787045\n951782400\n");
    assert.equal(result.stderr, "");
  }
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "2025-01-02T03:04:05Z\n2000-02-29");
});

test("date file stdin continues after invalid lines and samples relative clock once", async () => {
  let calls = 0;
  const stdin = (async function* () {
    yield Buffer.from("@0\ninvalid\nno");
    yield Buffer.from("w\n1 second\n");
  })();
  const result = await run("date", ["-f-", "+%s"], { clock: () => { calls++; return 1000; } }, { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "0\n1\n2\n");
  assert.equal(result.stderr, "date: unsupported or invalid date: invalid\n");
  assert.equal(calls, 1);
});

test("date empty file emits nothing; missing files and conflicting sources fail", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  const empty = await run("date", ["-f/empty"], { clock: () => { throw new Error("clock unused"); } }, { fs });
  assert.equal(empty.exitCode, 0); assert.equal(empty.stdout, ""); assert.equal(empty.stderr, "");
  for (const args of [["-f"], ["--file"], ["-fmissing"], ["--file="], ["-f/empty", "-d@0"], ["-r/empty", "-f/empty"], ["-f/empty", "--set=@0"]]) {
    const result = await run("date", args, {}, { fs });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.notEqual(result.stderr, "");
  }
});

test("date file output uses a cumulative quota and bounds input lines", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("@0\n@1\n"));
  await assert.rejects(run("date", ["-f/input", "+%s"], { limits: { maxOutputBytes: 3 } }, { fs }), { code: "EFBIG" });
  await fs.writeFile("/input", Buffer.from("@0000000000000000000000"));
  await assert.rejects(run("date", ["-f/input"], { limits: { maxArgumentBytes: 16 } }, { fs }), { code: "EFBIG" });
});

test("date supports ISO/RFC3339 precision prefixes, --rfc-822, >9 fractional digits, empty -d, and negative-year epochs", async () => {
  assert.equal((await run("date", ["-u", "-d", "@0", "-Is"])).stdout, "1970-01-01T00:00:00+00:00\n");
  assert.equal((await run("date", ["-u", "-d", "@0", "-Isec"])).stdout, "1970-01-01T00:00:00+00:00\n");
  assert.equal((await run("date", ["-u", "-d", "@0", "-Im"])).stdout, "1970-01-01T00:00+00:00\n");
  assert.equal((await run("date", ["-u", "-d", "@0", "-Ih"])).stdout, "1970-01-01T00+00:00\n");
  assert.equal((await run("date", ["-u", "-d", "@0", "-Id"])).stdout, "1970-01-01\n");
  assert.equal((await run("date", ["-u", "-d", "@0", "-In"])).stdout, "1970-01-01T00:00:00,000000000+00:00\n");
  assert.equal((await run("date", ["-u", "-d", "@0", "--rfc-3339=s"])).stdout, "1970-01-01 00:00:00+00:00\n");
  assert.equal((await run("date", ["-u", "-d", "@0", "--rfc-822"])).stdout, "Thu, 01 Jan 1970 00:00:00 +0000\n");
  assert.equal((await run("date", ["-u", "-d", "@0.1234567899", "+%N"])).stdout, "123456789\n");
  assert.equal((await run("date", ["-u", "-d", "", "+%T"])).stdout, "00:00:00\n");
  assert.equal((await run("date", ["-u", "-d", "@-63745056000", "+%F"])).stdout, "-050-01-01\n");
});
