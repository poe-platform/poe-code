import assert from "node:assert/strict";
import test from "node:test";
import { binary, execute, fixture } from "./zip-standard-flags.helpers.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
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

for (const option of ["dc", "dd", "lf", "TT", "mm"]) {
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

for (const option of ["dc", "dd", "lf", "TT", "mm"]) {
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
