import assert from "node:assert/strict";
import test from "node:test";
import { archiveBytes, execute, fixture, modified } from "./zip-standard-flags.helpers.js";
import { zipLatestTime } from "../../src/commands/archive/zip/dates.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";

for (const flag of ["-o", "--latest-time", "--latest-t"]) {
  test(`zip ${flag} timestamp-only operation preserves original archive bytes`, async () => {
    const fs = await fixture();
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-q", flag, "sample.zip"]);
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, modified.getTime());
    assert.equal((await fs.stat("/work/sample.zip")).atimeMs, modified.getTime());
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

for (const offset of [0, 1000, 1900]) {
  test(`zip latest time rounds upward from whole seconds ${offset}`, async () => {
    const fs = await fixture();
    const stamp = modified.getTime() + offset;
    await fs.utimes!("/work/binary", stamp, stamp);
    const result = await execute("zip", fs, ["-qo", "out.zip", "binary"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/work/out.zip")).mtimeMs, modified.getTime() + (offset ? 2000 : 0));
  });
}

test("zip latest time ignores directories and considers retained members", async () => {
  const fs = await fixture(await archiveBytes([{ name: "folder/", body: Buffer.alloc(0) }, { name: "binary", body: Buffer.from("old") }], entries => {
    entries[0]!.modified = new Date(modified.getTime() + 10000);
  }));
  const result = await execute("zip", fs, ["-qo", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, modified.getTime());
});

test("zip latest time recalculates after deleting newest member", async () => {
  const fs = await fixture(await archiveBytes([{ name: "older", body: Buffer.from("a") }, { name: "newer", body: Buffer.from("b") }], entries => {
    entries[1]!.modified = new Date(modified.getTime() + 10000);
  }));
  const result = await execute("zip", fs, ["-qdo", "sample.zip", "newer"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, modified.getTime());
});

for (const action of ["-u", "-f"]) {
  test(`zip latest time runs for unchanged ${action} while retaining status 12`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }]));
    await fs.utimes!("/work/binary", 0, 0);
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-qo", action, "sample.zip"]);
    assert.equal(result.exitCode, 12, result.stderr);
    assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, modified.getTime());
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

test("zip latest timestamp is supplied to staging before publication", async () => {
  const fs = await fixture();
  let stagedTime: number | undefined;
  const observed = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "createStagedFile") return (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      stagedTime = args[3].mtimeMs;
      return value.apply(target, args);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", observed, ["-qo", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(stagedTime, modified.getTime());
});

test("zip latest timestamp rejected by staging preserves destination and cleans up", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const prior = await fs.stat("/work/sample.zip");
  const ignored = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "createStagedFile") return (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const { mtimeMs: ignoredTime, ...options } = args[3];
      return value.apply(target, [args[0], args[1], args[2], options]);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", ignored, ["-qo", "sample.zip"]);
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /did not retain archive modification time/);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, prior.mtimeMs);
  assert.equal((await fs.readdir("/work")).some(entry => entry.name.startsWith(".zip-")), false);
});

test("zip latest timestamp for separate output respects selected copied members", async () => {
  const fs = await fixture(await archiveBytes([{ name: "older", body: Buffer.from("a") }, { name: "newer", body: Buffer.from("b") }], entries => {
    entries[1]!.modified = new Date(modified.getTime() + 10000);
  }));
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qoU", "sample.zip", "older", "-O", "out.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/out.zip")).mtimeMs, modified.getTime());
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("zip latest timestamp ignores stdout archives without staged publication", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qo", "-", "binary"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const archive = await readZipArchive(result.stdout, settings({}), new AbortController().signal);
  assert.equal(archive.entries[0]!.name, "binary");
});

test("zip only-directory latest timestamp warning is suppressed by quiet", async () => {
  const fs = await fixture(await archiveBytes([{ name: "folder/", body: Buffer.alloc(0) }]));
  const priorTime = modified.getTime() - 60000;
  await fs.utimes!("/work/sample.zip", priorTime, priorTime);
  for (const quiet of [false, true]) {
    const result = await execute("zip", fs, [quiet ? "-qo" : "-o", "sample.zip"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), quiet ? "" : "\tzip warning: zip file has only directories, can't make it as old as latest entry\n");
    assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, priorTime);
  }
});

test("zip latest timestamp clamps pre-DOS times and rounds across midnight", async () => {
  const archive = await readZipArchive(await archiveBytes([{ name: "a", body: Buffer.from("a") }]), settings({}), new AbortController().signal);
  const entry = archive.entries[0]!;
  entry.modified = new Date(1979, 11, 31, 12, 0, 0);
  assert.equal(await zipLatestTime([entry], new AbortController().signal), new Date(1980, 0, 1).getTime());
  entry.modified = new Date(2024, 0, 2, 23, 59, 59);
  assert.equal(await zipLatestTime([entry], new AbortController().signal), new Date(2024, 0, 3).getTime());
});

test("zip latest timestamp selection is cancellation-aware", async () => {
  const archive = await readZipArchive(await archiveBytes([{ name: "a", body: Buffer.from("a") }]), settings({}), new AbortController().signal);
  const controller = new AbortController();
  controller.abort(false);
  await assert.rejects(zipLatestTime(archive.entries, controller.signal), error => error === false);
  await assert.rejects(zipLatestTime([], controller.signal), error => error === false);
});

test("zip latest time still integrity-tests unchanged directory-only archives", async () => {
  const fs = await fixture(await archiveBytes([{ name: "folder/", body: Buffer.alloc(0) }]));
  const priorTime = modified.getTime() - 60000;
  await fs.utimes!("/work/sample.zip", priorTime, priorTime);
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-oT", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "test of sample.zip OK\n\tzip warning: zip file has only directories, can't make it as old as latest entry\n");
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, priorTime);
});

for (const flags of [["-T"], ["-u", "-T"], ["-f", "-T"], ["-u", "-o", "-T"]]) {
  test(`zip standalone and unchanged integrity mode ${flags} succeeds without rewriting bytes`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }]));
    await fs.utimes!("/work/binary", 0, 0);
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-q", ...flags, "sample.zip"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

test("zip standalone integrity mode rejects bad retained CRC without publishing", async () => {
  const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }], entries => { entries[0]!.crc32 = 1; }));
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qT", "sample.zip"]);
  assert.equal(result.exitCode, 8, result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("zip latest time rejects bad directory CRC under -T before publication", async () => {
  const fs = await fixture(await archiveBytes([{ name: "folder/", body: Buffer.alloc(0) }], entries => { entries[0]!.crc32 = 1; }));
  const before = await fs.readFile("/work/sample.zip");
  const prior = await fs.stat("/work/sample.zip");
  const result = await execute("zip", fs, ["-qoT", "sample.zip"]);
  assert.equal(result.exitCode, 8, result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, prior.mtimeMs);
});

for (const corrupt of [false, true]) {
  test(`zip unmatched copy integrity mode tests input without creating output (corrupt=${corrupt})`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }], entries => { if (corrupt) entries[0]!.crc32 = 1; }));
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-qTU", "sample.zip", "missing", "-O", "out.zip"]);
    assert.equal(result.exitCode, corrupt ? 8 : 0, result.stderr);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.equal((await fs.readdir("/work")).some(entry => entry.name === "out.zip"), false);
  });
}
