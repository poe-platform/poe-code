import assert from "node:assert/strict";
import test from "node:test";
import { binary, execute, fixture } from "./zip-standard-flags.helpers.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { createCommandArguments } from "../../src/contracts/command.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { settings } from "../../src/commands/archive/internal.js";

for (const args of [["-h"], ["--help"], ["--hel"], ["-qh"], ["-h", "--unknown"], ["missing.zip", "missing", "-h"], ["-h", "-"]]) {
  test(`zip help exits at the option without filesystem access ${args}`, async () => {
    const fs = await fixture();
    const denied = new Proxy(fs, { get(target, key) {
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? () => { throw new Error(`unexpected filesystem operation ${String(key)}`); } : value;
    } });
    const result = await execute("zip", denied, args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.toString().includes("zip [options] archive"), result.stdout.toString());
    assert.ok(result.stdout.toString().includes("bzip2"));
    assert.equal(result.stderr, "");
  });
}

for (const args of [["-h-"], ["--help-"], ["--help=value"], ["--unknown", "-h"], ["--", "-h"]]) {
  test(`zip help retains preceding argument errors ${args}`, async () => {
    const result = await execute("zip", await fixture(), args);
    assert.equal(result.exitCode, 16);
    assert.ok(!result.stdout.toString().includes("zip [options] archive"));
  });
}

test("zip help from ZIPOPT precedes explicit invalid arguments", async () => {
  const result = await execute("zip", await fixture(), ["--unknown"], {}, { env: { ZIPOPT: "-h" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.toString().includes("zip [options] archive"));
});

test("zip treats help-looking arguments after literal terminator as filenames", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/-h", new TextEncoder().encode("literal help file"));
  const result = await execute("zip", fs, ["-q", "out.zip", "--", "-h"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, 0);
  const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries[0]!.name, "-h");
});

for (const option of ["mm"]) {
  for (const prefix of ["", "q"]) {
    test(`zip refuses reserved -${prefix}${option} without touching archive, sources or stdin`, async () => {
      const fs = await fixture();
      const before = await fs.readFile("/work/sample.zip");
      const paths = await fs.readdir("/work");
      const result = await execute("zip", fs, [`-${prefix}${option}`, "sample.zip", "binary"], {}, {
        stdin: (async function* () { assert.fail("invalid options must not pull stdin"); yield binary; })(),
      });
      assert.equal(result.exitCode, 16, result.stderr);
      assert.match(result.stdout.toString(), /unsupported option/);
      assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
      assert.deepEqual(await fs.readFile("/work/binary"), Uint8Array.from(binary));
      assert.deepEqual(await fs.readdir("/work"), paths);
      const control = await execute("zip", fs, ["-q", "control.zip", "binary"]);
      assert.equal(control.exitCode, 0, control.stderr);
    });
  }
}

for (const option of ["mm"]) {
  test(`zip reserved -${option} honors option boundaries, environment defaults and help order`, async () => {
    for (const args of [
      [`-${option}-`, "sample.zip", "binary"],
      [`-${option}=value`, "sample.zip", "binary"],
      ["sample.zip", "binary", `-${option}`],
      [`-${option}`, "-h"],
    ]) {
      const fs = await fixture();
      const before = await fs.readFile("/work/sample.zip");
      assert.equal((await execute("zip", fs, args)).exitCode, 16);
      assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
      assert.deepEqual(await fs.readFile("/work/binary"), Uint8Array.from(binary));
    }
    assert.equal((await execute("zip", await fixture(), ["sample.zip", "binary"], {}, {
      env: { ZIPOPT: `-${option}` },
    })).exitCode, 16);
    assert.equal((await execute("zip", await fixture(), ["-h", `-${option}`])).exitCode, 0);
    const fs = await fixture();
    await fs.writeFile(`/work/-${option}`, binary);
    assert.equal((await execute("zip", fs, ["-q", "literal.zip", "--", `-${option}`])).exitCode, 0);
    const archive = await readZipArchive(await fs.readFile("/work/literal.zip"), settings({}), new AbortController().signal);
    assert.equal(archive.entries[0]!.name, `-${option}`);
  });

  test(`zip cancellation while reporting reserved -${option} preserves reason and files`, async () => {
    const fs = await fixture();
    const before = await fs.readFile("/work/sample.zip");
    const controller = new AbortController();
    const reason = new Error("cancel reserved-option diagnostic");
    let writes = 0;
    await assert.rejects(execute("zip", fs, [`-${option}`, "sample.zip", "binary"], {}, {
      signal: controller.signal,
      stdout: { async write() { writes++; controller.abort(reason); } },
    }), error => error === reason);
    assert.equal(writes, 1);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.deepEqual(await fs.readFile("/work/binary"), Uint8Array.from(binary));
    assert.equal((await execute("zip", fs, ["-q", "control.zip", "binary"])).exitCode, 0);
  });
}

for (const option of ["-v", "--version", "-L", "--license"]) {
  test(`zip information ${option} is truthful and performs no I/O`, async () => {
    const fs = new Proxy(await fixture(), { get(target, key) {
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? () => { assert.fail(`unexpected FS ${String(key)}`); } : value;
    } });
    const result = await execute("zip", fs, [option], {}, {
      stdin: (async function* () { assert.fail("information pulled stdin"); yield binary; })(),
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout.toString(), /safe-bash zip/);
    assert.doesNotMatch(result.stdout.toString(), /Compiled with|This is Zip 3.0/);
    assert.equal(result.stderr, "");
  });
}

test("zip show-command parses all arguments and exits at 9 without I/O", async () => {
  const fs = await fixture();
  const before = await fs.readdir("/work");
  const result = await execute("zip", fs, ["-sc", "out.zip", "binary"], {}, { env: { ZIPOPT: "-q" } });
  assert.equal(result.exitCode, 9);
  assert.match(result.stdout.toString(), /command line:\n'zip' {2}'-q' {2}'-sc'/);
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readdir("/work"), before);
  assert.equal((await execute("zip", fs, ["-sc", "--unknown"])).exitCode, 16);
});

test("zip show-options lists only implemented options and validates later errors", async () => {
  const result = await execute("zip", await fixture(), ["--show-options"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout.toString(), /available options:/);
  assert.match(result.stdout.toString(), /show-files/);
  assert.match(result.stdout.toString(), /password\s+req/u);
  assert.match(result.stdout.toString(), /encrypt/u);
  assert.match(result.stdout.toString(), /split-size/);
  assert.equal((await execute("zip", await fixture(), ["-so", "--unknown"])).exitCode, 16);
});

for (const option of ["-sf", "--show-files", "-sf-", "-qsf"]) {
  test(`zip ${option} lists without reading source payload or publishing`, async () => {
    const base = await fixture();
    const fs = new Proxy(base, { get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (key === "readFile" || key === "readStream" || key === "writeFile" || key === "atomic") return () => { assert.fail(`listing used ${String(key)}`); };
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await execute("zip", fs, [option, "out.zip", "binary"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout.toString(), /Total 1 entries \(6 bytes\)/);
    if (option === "-sf" || option === "--show-files") assert.match(result.stdout.toString(), /Would Add\/Update:\n {2}binary\n/);
    else assert.equal(result.stdout.toString(), "Total 1 entries (6 bytes)\n");
    assert.equal((await base.readdir("/work")).some(entry => entry.name === "out.zip"), false);
  });
}

for (const option of ["-dc", "--display-counts", "-db", "-du", "-dv", "-dd", "-dg", "-ds32k", "-sd"]) {
  test(`zip operational ${option} preserves binary payload`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, [option, "out.zip", "binary"]);
    assert.equal(result.exitCode, 0, result.stderr);
    if (option === "-dc" || option === "--display-counts") assert.match(result.stdout.toString(), /0\/ {2}1/);
    if (option === "-db") assert.match(result.stdout.toString(), /\[ {3}0\/ {3}6\]/);
    if (option === "-du") assert.match(result.stdout.toString(), /binary \(6\)/);
    if (option === "-dv") assert.match(result.stdout.toString(), /1>1:/);
    if (option === "-sd") assert.match(result.stdout.toString(), /sd: Command line read/);
    const control = await execute("unzip", fs, ["-p", "out.zip", "binary"]);
    assert.equal(control.exitCode, 0);
    assert.deepEqual(control.stdout, binary);
  });
}

for (const option of ["--show", "--display", "--ver", "--unknown=private", "--verbose=", "--version=", "--license=x", "--show-files=", "--show-command-", "--show-debug-", "--show-options-", "-v-", "-L-", "-ds-", "-sc=", "-sd=", "-so=", "-sf=", "-dc=", "-db="]) {
  test(`zip rejects display grammar ${option} before I/O`, async () => {
    const fs = await fixture();
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, [option, "sample.zip", "binary"]);
    assert.equal(result.exitCode, 16);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout.toString(), /private/);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

for (const value of ["", "0", "1", "1023", "32k", "32K", "32768", "01m", "1g", "1t"]) {
  test(`zip accepts native dot size ${JSON.stringify(value)}`, async () => {
    for (const args of [[`--dot-size=${value}`, "-h"], ["-ds", value, "-h"], [`-qds=${value}`, "-h"]]) {
      const result = await execute("zip", await fixture(), args);
      assert.equal(result.exitCode, 0, result.stdout.toString());
      assert.match(result.stdout.toString(), /Usage: zip/);
    }
  });
}
for (const value of ["-1", "1024", "31k", "1kb", "1.5m", "1e", " 32k", "100000000", "9999999t"]) {
  test(`zip refuses invalid or unsafe dot size ${value}`, async () => {
    const result = await execute("zip", await fixture(), ["-ds", value, "-h"]);
    assert.equal(result.exitCode, 16);
    assert.doesNotMatch(result.stdout.toString(), /Usage: zip/);
  });
}

test("zip short v, long verbose, grouped verbose and quiet retain native distinctions", async () => {
  for (const args of [["--verbose"], ["-qv"], ["-vv"]]) {
    const result = await execute("zip", await fixture(), args, {}, { stdin: (async function* () { yield binary; })() });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.readUInt32LE(0), 0x04034b50);
    assert.match(result.stderr, /in=6/);
    assert.match(result.stderr, /total bytes=6/);
  }
  for (const [option, quiet] of [["-vq", true], ["-qv", false]] as const) {
    const result = await execute("zip", await fixture(), [option, "out.zip", "binary"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length === 0, quiet);
  }
  const env = await execute("zip", await fixture(), ["-v"], {}, { env: { ZIPOPT: "-q" } });
  assert.equal(env.stdout.readUInt32LE(0), 0x04034b50);
  for (const option of ["--version", "--versi", "-L", "--lic", "-qL"]) {
    const result = await execute("zip", await fixture(), [option, "--unknown"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout.toString(), /safe-bash zip/);
    assert.equal((await execute("zip", await fixture(), ["--unknown", option])).exitCode, 16);
  }
});

test("zip show-command reorders option lists, escapes controls and redacts credentials", async () => {
  const result = await execute("zip", await fixture(), ["-sc", "out", "binary", "-qi", "binary"], {}, { env: { ZIPOPT: "-dc" } });
  assert.equal(result.exitCode, 9);
  assert.match(result.stdout.toString(), /'-dc' {2}'-sc' {2}'-qi' {2}'binary' {2}'@' {2}'out' {2}'binary'/);
  const url = await execute("zip", await fixture(), ["-sc", "out", "--", "https://user:private@example.com/x?token=private", "-Pprivate", "line\nname", "a'b"]);
  assert.equal(url.exitCode, 9);
  assert.doesNotMatch(url.stdout.toString(), /private|user:|token=/);
  assert.ok(url.stdout.toString().includes("line\\nname"));
  assert.ok(url.stdout.toString().includes("a'\\''b"));
  for (const args of [["-sc", "-Pprivate", "out", "binary"], ["-sd", "--password=private", "out", "binary"]]) {
    const refusal = await execute("zip", await fixture(), args);
    assert.equal(refusal.exitCode, args[0] === "-sc" ? 9 : 2);
    assert.doesNotMatch(refusal.stdout.toString() + refusal.stderr, /private/);
  }
  const attached = await execute("zip", await fixture(), ["-sc", "out", "binary", "--include=binary"]);
  assert.equal(attached.exitCode, 9);
  assert.doesNotMatch(attached.stdout.toString(), /'@'/);
});

test("zip listing reuses selection, reads archive metadata and avoids move/comments/test/output effects", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const paths = await fs.readdir("/work");
  for (const [args, title, total] of [
    [["-sf", "sample.zip"], "Archive contains", 5],
    [["-sf", "sample.zip", "-d", "binary"], "Would Delete", 1],
    [["-sf", "sample.zip", "-U", "binary"], "Would Copy", 1],
    [["-sf", "out.zip", "-rD", "folder", "-x", "*/data"], "Would Add/Update", 0],
    [["-sf", "sample.zip", "binary", "-mzcT", "-O", "missing/out"], "Would Add/Update", 1],
  ] as const) {
    const result = await execute("zip", fs, args, {}, { stdin: (async function* () { assert.fail("listing read comments"); yield binary; })() });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.toString().includes(`${title}:`));
    assert.ok(result.stdout.toString().includes(`Total ${total} entries`));
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.deepEqual(await fs.readFile("/work/binary"), Uint8Array.from(binary));
    assert.deepEqual(await fs.readdir("/work"), paths);
  }
  assert.equal((await execute("zip", fs, ["-sf", "missing.zip"])).exitCode, 18);
  assert.equal((await execute("zip", fs, ["-sf", "sample.zip", "-i", "binary"])).exitCode, 16);
  const literal = await execute("zip", fs, ["-sf", "out.zip", "--", "-v"]);
  assert.equal(literal.exitCode, 0);
  assert.match(literal.stdout.toString(), /Total 0 entries/);
});

test("zip display counters reflect filtered entries, deletion and copy in archive order", async () => {
  for (const action of [[], ["-d"], ["-U", "-O", "copy.zip"]]) {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-dcdbdudv", "sample.zip", "binary", "folder/data", "-x", "folder/data", ...action]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout.toString(), /1>1: {3}0\/ {2}1 \[ {3}0\/ {3}6\]/);
    assert.doesNotMatch(result.stdout.toString(), /folder\/data/);
  }
  const two = await execute("zip", await fixture(), ["-dcdb", "out.zip", "binary", "folder/data"]);
  assert.equal(two.exitCode, 0);
  assert.match(two.stdout.toString(), / {2}0\/ {2}2/);
  assert.match(two.stdout.toString(), / {2}1\/ {2}1 \[ {3}6\//);
  const off = await execute("zip", await fixture(), ["-dcdbdudv", "out.zip", "binary", "--display-counts-", "--display-bytes-", "--display-usize-", "--display-volume-"]);
  assert.equal(off.exitCode, 0);
  assert.equal(off.stdout.toString(), "  adding: binary (stored 0%)\n");
});

for (const option of ["-v", "--version", "-L", "-so", "-sc", "-sf", "-dc", "-db", "-du", "-dv", "-ddds32k", "-qdgds32k", "-sd"]) {
  test(`zip ${option} output cancellation preserves reason and permits a fresh invocation`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/large", new Uint8Array(65536));
    const controller = new AbortController();
    const reason = new Error(`cancel ${option}`);
    let writes = 0;
    const args = option === "-v" ? [option] : [option, "out.zip", "large"];
    await assert.rejects(execute("zip", fs, args, {}, {
      signal: controller.signal,
      stdout: { async write() { writes++; controller.abort(reason); } },
    }), error => error === reason);
    assert.equal(writes, 1);
    assert.equal((await execute("zip", fs, ["-q", "control.zip", "binary"])).exitCode, 0);
  });
}

test("zip display text limits and argument limits refuse without unbounded output", async () => {
  for (const args of [["--version"], ["-L"], ["-so"], ["-sc", "archive", "binary"], ["-sf", "out", "binary"], ["-dc", "out", "binary"]]) {
    const result = await execute("zip", await fixture(), args, { limits: { maxTextBytes: 8 } });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /text output limit exceeded/);
    assert.ok(result.stdout.length <= 8);
  }
  const arg = await execute("zip", await fixture(), ["--version"], { limits: { maxArgumentBytes: 4 } });
  assert.equal(arg.exitCode, 2);
  assert.doesNotMatch(arg.stdout.toString(), /safe-bash zip/);
});

test("zip -version is a grouped short argument, not the long version exit", async () => {
  const result = await execute("zip", await fixture(), ["-version"]);
  assert.equal(result.exitCode, 16);
  assert.doesNotMatch(result.stdout.toString(), /safe-bash zip/);
});

test("zip debug accompanies deferred information without exposing archive paths", async () => {
  for (const option of ["-sc", "-so"]) {
    const result = await execute("zip", await fixture(), ["-sd", option]);
    assert.equal(result.exitCode, option === "-sc" ? 9 : 0);
    assert.match(result.stdout.toString(), /^sd: Command line read\n/);
  }
});

test("zip dots respect interval boundaries, mode ordering, negation and ZIPOPT precedence", async () => {
  for (const size of [32767, 32768, 32769, 65536]) {
    const fs = await fixture();
    await fs.writeFile("/work/large", new Uint8Array(size));
    const perFile = await execute("zip", fs, ["-0ddds32k", "out.zip", "large"]);
    assert.equal(perFile.exitCode, 0);
    assert.equal(perFile.stdout.toString(), `  adding: large ${".".repeat(Math.floor(size / 32768))}${size >= 32768 ? " " : ""}(stored 0%)\n`);
    const global = await execute("zip", fs, ["-0qdgds32k", "global.zip", "large"]);
    assert.equal(global.exitCode, 0);
    const length = (await fs.readFile("/work/global.zip")).length;
    assert.equal(global.stdout.toString(), ` ${".".repeat(Math.floor(length / 32768))}\n`);
    const control = await execute("unzip", fs, ["-p", "global.zip", "large"]);
    assert.equal(control.exitCode, 0);
    assert.deepEqual(control.stdout, Buffer.alloc(size));
    for (const args of [["-0ddds32k", "-q"], ["-0qdgds32k", "-dd-"], ["-0qdgds32k", "-dg-", "-ds0"]]) {
      const off = await execute("zip", fs, [...args, "off.zip", "large"]);
      assert.equal(off.exitCode, 0);
      assert.equal(off.stdout.length, 0);
    }
    const precedence = await execute("zip", fs, ["-0q", "--dot-size=0", "env.zip", "large"], {}, { env: { ZIPOPT: "-dg -ds32k" } });
    assert.equal(precedence.exitCode, 0);
    assert.equal(precedence.stdout.toString(), "\n");
  }
});

test("zip stdout diagnostics and dots preserve binary output and cancellation during source reads", async () => {
  const fs = await fixture();
  const source = Buffer.alloc(65536);
  const result = await execute("zip", fs, ["-0qdgds32k", "-", "-"], {}, { stdin: (async function* () { yield source; })() });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.readUInt32LE(0), 0x04034b50);
  assert.equal(result.stderr, " ..\n");
  for (const option of ["-dc", "-ddds32k", "-dgds32k", "-sd", "--verbose"]) {
    const controller = new AbortController();
    const reason = new Error("cancel display input");
    await assert.rejects(execute("zip", fs, [option, "-", "-"], {}, {
      signal: controller.signal,
      stdin: (async function* () { yield binary; controller.abort(reason); controller.signal.throwIfAborted(); })(),
    }), error => error === reason);
    assert.equal((await execute("zip", fs, ["-q", "control.zip", "binary"])).exitCode, 0);
  }
});

test("zip show-command redacts separate literal password values and escaped executable names", async () => {
  const result = await execute("zip", await fixture(), ["-sc", "out.zip", "--", "-P", "private", "--password", "other-private"]);
  assert.equal(result.exitCode, 9);
  assert.doesNotMatch(result.stdout.toString(), /private/);
  const name = await execute("zip", await fixture(), ["-sc", "out.zip", "binary"], {}, { command: "zip\nname" });
  assert.equal(name.exitCode, 9);
  assert.ok(name.stdout.toString().includes("'zip\\nname'"));
});

test("zip show-command redacts native password abbreviations without consuming unrelated paths", async () => {
  const fs = await fixture();
  const before = await fs.readdir("/work");
  for (const option of ["--pas", "--pass", "--passw", "--passwo", "--passwor", "--password", "-qP"]) {
    for (const args of [[option, "private", "binary"], [`${option}=private`, "binary"], [`${option}=`, "binary"]]) {
      const result = await execute("zip", fs, ["-qsc", "out.zip", "--", ...args]);
      assert.equal(result.exitCode, 9);
      assert.ok(!result.stdout.toString().includes("private"));
      assert.ok(result.stdout.toString().includes("'binary'"));
      assert.ok(result.stdout.toString().includes("[redacted]"));
      assert.equal(result.stderr, "");
    }
  }
  const attached = await execute("zip", fs, ["-sc", "out.zip", "--", "-qPprivateP", "binary", "--paths", "visible"]);
  assert.equal(attached.exitCode, 9);
  assert.ok(!attached.stdout.toString().includes("private"));
  assert.ok(attached.stdout.toString().includes("'binary'"));
  assert.ok(attached.stdout.toString().includes("'visible'"));
  assert.deepEqual(await fs.readdir("/work"), before);
  assert.equal((await execute("zip", fs, ["-sc", "out.zip", "--", "--pass", ""])).exitCode, 2);
  assert.equal((await execute("zip", fs, ["-sc", "--pass=private", "out.zip", "binary"])).exitCode, 9);
  const controller = new AbortController();
  const reason = new Error("cancel password abbreviation display");
  await assert.rejects(execute("zip", fs, ["-sc", "out.zip", "--", "--pass", "private"], {}, {
    signal: controller.signal,
    stdout: { async write() { controller.abort(reason); } },
  }), error => error === reason);
  assert.deepEqual(await fs.readdir("/work"), before);
  assert.equal((await execute("zip", fs, ["-q", "control.zip", "binary"])).exitCode, 0);
});

test("zip debug warning and progress redact credential-bearing paths", async () => {
  const fs = await fixture();
  const missing = await execute("zip", fs, ["-sd", "out.zip", "https://user:private@example.com/x?token=private"]);
  assert.equal(missing.exitCode, 12);
  assert.doesNotMatch(missing.stdout.toString() + missing.stderr, /private|user:/);
  await fs.mkdir("/work/https:/user:private@example.com", { recursive: true });
  await fs.writeFile("/work/https:/user:private@example.com/x?token=private", binary);
  const present = await execute("zip", fs, ["-sd", "out.zip", "https://user:private@example.com/x?token=private"]);
  assert.equal(present.exitCode, 2);
  assert.doesNotMatch(present.stdout.toString() + present.stderr, /private|user:/);
  await fs.writeFile("/work/x?token=private", binary);
  const progress = await execute("zip", fs, ["-sd", "out.zip", "x?token=private"]);
  assert.equal(progress.exitCode, 0);
  assert.doesNotMatch(progress.stdout.toString() + progress.stderr, /private/);
});

test("zip native dd negation retains the configured interval, while filesync listing includes current files", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/large", new Uint8Array(65536));
  const dots = await execute("zip", fs, ["-0ddds32k", "-dd-", "out.zip", "large"]);
  assert.equal(dots.exitCode, 0);
  assert.match(dots.stdout.toString(), /large \.\./);
  assert.equal((await execute("zip", fs, ["-q", "current.zip", "binary"])).exitCode, 0);
  const listing = await execute("zip", fs, ["-sf", "-FS", "current.zip", "binary"]);
  assert.equal(listing.exitCode, 0);
  assert.equal(listing.stdout.toString(), "Would Add/Update:\n  binary\nTotal 1 entries (6 bytes)\n");
});

test("zip quiet per-entry dots do not consume text budget while global dots remain bounded", async () => {
  const fs = await fixture();
  const bytes = new Uint8Array(65536);
  await fs.writeFile("/work/large", bytes);
  const options = { limits: { maxTextBytes: 1 } };
  const quiet = await execute("zip", fs, ["-0qddds32k", "quiet.zip", "large"], options);
  assert.equal(quiet.exitCode, 0, quiet.stderr);
  assert.equal(quiet.stdout.length, 0);
  assert.equal(quiet.stderr, "");
  const archive = await readZipArchive(await fs.readFile("/work/quiet.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries[0]!.size, bytes.length);
  assert.deepEqual(archive.entries[0]!.data, bytes);
  for (const flags of ["-0ddds32k", "-0qdgds32k"]) {
    const limited = await execute("zip", fs, [flags, "limited.zip", "large"], options);
    assert.equal(limited.exitCode, 2);
    assert.match(limited.stderr, /text output limit exceeded/);
  }
  assert.ok(!(await fs.readdir("/work")).some(entry => entry.name === "limited.zip"));
  const controller = new AbortController();
  const reason = new Error("cancel quiet dot source");
  await assert.rejects(execute("zip", fs, ["-0qddds32k", "-", "-"], options, {
    signal: controller.signal,
    stdin: (async function* () { yield bytes; controller.abort(reason); controller.signal.throwIfAborted(); })(),
  }), error => error === reason);
  assert.equal((await execute("zip", fs, ["-q", "control.zip", "binary"], options)).exitCode, 0);
});

test("zip debug generic filesystem failures and grouped credential paths redact values", async () => {
  const fs = await fixture();
  const command = await execute("zip", fs, ["-sc", "out", "--", "-qPprivate"]);
  assert.equal(command.exitCode, 9);
  assert.doesNotMatch(command.stdout.toString(), /private/);
  const failure = await execute("zip", fs, ["-sd", "https://user:private@example.com/out"]);
  assert.equal(failure.exitCode, 2);
  assert.doesNotMatch(failure.stdout.toString() + failure.stderr, /private|user:/);
});

test("zip byte counters and entry sizes use scanned size before line-ending conversion", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/text", Buffer.from("a\nb\n"));
  const result = await execute("zip", fs, ["-0ldbduv", "out.zip", "text"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout.toString(), /\[ {3}0\/ {3}4\] {3}adding: text \(4\).*\(in=6\) \(out=6\)/);
  const output = await execute("unzip", fs, ["-p", "out.zip", "text"]);
  assert.equal(output.exitCode, 0);
  assert.deepEqual(output.stdout, Buffer.from("a\r\nb\r\n"));
});


test("zip command and debug redact credential URLs with omitted authority slashes", async () => {
  const fs = await fixture();
  const before = await fs.readdir("/work");
  for (const scheme of ["http", "https", "ftp", "ws", "wss"]) {
    for (const slashes of ["", "/", "//"]) {
      const path = `${scheme}:${slashes}user:private-value@example.test/path?key=private-value`;
      const command = await execute("zip", fs, ["-qsc", "out.zip", "--", path, "binary", "notes:ordinary"]);
      assert.equal(command.exitCode, 9);
      assert.doesNotMatch(command.stdout.toString() + command.stderr, /private-value|user:/);
      assert.ok(command.stdout.toString().includes("'binary'"));
      assert.ok(command.stdout.toString().includes("'notes:ordinary'"));
      const warning = await execute("zip", fs, ["-sd", "out.zip", path]);
      assert.equal(warning.exitCode, 12);
      assert.doesNotMatch(warning.stdout.toString() + warning.stderr, /private-value|user:/);
      const listing = await execute("zip", fs, ["-sf", "out.zip", path]);
      assert.equal(listing.exitCode, 0);
      assert.doesNotMatch(listing.stdout.toString() + listing.stderr, /private-value|user:/);
    }
  }
  const malformed = await execute("zip", fs, ["-sc", "out.zip", "--", "https:user:private-value@[", "binary"]);
  assert.equal(malformed.exitCode, 9);
  assert.doesNotMatch(malformed.stdout.toString(), /private-value/);
  const controller = new AbortController();
  const reason = new Error("cancel credential URL display");
  await assert.rejects(execute("zip", fs, ["-sc", "out.zip", "--", "https:user:private-value@example.test/path"], {}, {
    signal: controller.signal,
    stdout: { async write() { controller.abort(reason); } },
  }), error => error === reason);
  assert.deepEqual(await fs.readdir("/work"), before);
  assert.equal((await execute("zip", fs, ["-q", "control.zip", "binary"])).exitCode, 0);
  assert.deepEqual((await execute("unzip", fs, ["-p", "control.zip", "binary"])).stdout, binary);
});

test("zip information accepts owned byte argv and refuses non-UTF8 filename bytes before I/O", async () => {
  const fs = new Proxy(await fixture(), { get(target, key) {
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? () => { assert.fail(`unexpected FS ${String(key)}`); } : value;
  } });
  const version = createCommandArguments([shellValueFromBytes(Buffer.from("-v"))]);
  const positive = await execute("zip", fs, version.args, {}, { argumentValues: version });
  assert.equal(positive.exitCode, 0);
  assert.match(positive.stdout.toString(), /safe-bash zip/);
  for (const option of ["-h", "--version", "-L", "-sc", "-so", "-sf", "-dc", "-sd"]) {
    const values = createCommandArguments([option, "out.zip", shellValueFromBytes(Uint8Array.of(255))]);
    const result = await execute("zip", fs, values.args, {}, { argumentValues: values });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /valid UTF-8/);
  }
});
