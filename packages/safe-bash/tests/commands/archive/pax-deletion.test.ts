import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/index.js";
import { archive, checksum, direct, fixture, header, member, record, source } from "./helpers.js";

const data = Uint8Array.from({ length: 517 }, (_, index) => (index * 43 + 11) % 256);
const createdAtime = 1_600_000_006_250;
const createdMtime = 1_600_000_007_125;
const globalTime = 1_700_000_100.25;
const localTime = 1_700_000_200.5;
const records = (...pairs: [string, string][]) => Buffer.concat(pairs.map(([key, value]) => record(key, value)));
const extended = (type: "x" | "g", ...pairs: [string, string][]) => member("metadata", records(...pairs), type);

async function observed() {
  const fs = createMemoryFileSystem();
  const originalTimes = fs.utimes!.bind(fs);
  const originalWrite = fs.writeStream!.bind(fs);
  const originalMkdir = fs.mkdir.bind(fs);
  const calls: { path: string; atime: number; mtime: number }[] = [];
  fs.writeStream = async (path, bytes, options) => {
    await originalWrite(path, bytes, options);
    await originalTimes(path, createdAtime, createdMtime, options);
  };
  fs.mkdir = async (path, options) => {
    await originalMkdir(path, options);
    await originalTimes(path, createdAtime, createdMtime, options);
  };
  fs.utimes = async (path, atime, mtime, options) => {
    calls.push({ path, atime, mtime });
    await originalTimes(path, atime, mtime, options);
  };
  return { ...await fixture({}, fs), calls };
}

async function rejected(bytes: Uint8Array, diagnostic: RegExp, extra: string[] = [], modes = ["-tf", "-xf"]) {
  for (const mode of modes) {
    const { fs, shell } = await fixture();
    try {
      await fs.writeFile("/out/keep", Buffer.from("sentinel"));
      const before = await fs.stat("/out/keep");
      const result = await direct([mode, "-", "-C", "/out", ...extra], fs, { stdin: source(bytes) });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, diagnostic);
      assert.deepEqual(await fs.stat("/out/keep"), before);
      assert.deepEqual((await fs.readdir("/out")).map(entry => entry.name), ["keep"]);
      assert.equal(Buffer.from(await fs.readFile("/out/keep")).toString(), "sentinel");
    } finally { await shell.dispose(); }
  }
}

function mutated(name: string, changes: (bytes: Buffer) => void, type = "0", target = "", payload: Uint8Array = data) {
  const bytes = header(name, payload, type, target);
  changes(bytes);
  checksum(bytes);
  return Buffer.concat([bytes, payload, Buffer.alloc((512 - payload.length % 512) % 512)]);
}

test("D01 local deletion suppresses global and raw time for exactly one member", async () => {
  const { fs, shell, calls } = await observed();
  try {
    const bytes = archive(extended("g", ["mtime", String(globalTime)]), extended("x", ["mtime", ""]), member("deleted", data), member("following", data));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/out/deleted")).mtimeMs, createdMtime);
    assert.equal((await fs.stat("/out/following")).mtimeMs, globalTime * 1000);
    assert.deepEqual(calls.map(call => call.path), ["/out/following"]);
    assert.deepEqual(await fs.readFile("/out/deleted"), data);
  } finally { await shell.dispose(); }
});

test("D02 global tombstones persist per keyword until explicit reintroduction", async () => {
  const { fs, shell, calls } = await observed();
  try {
    const bytes = archive(extended("g", ["mtime", ""], ["uid", ""], ["gid", ""]), member("first", data), extended("g", ["comment", "unrelated"]), member("second", data), extended("g", ["mtime", String(globalTime)]), member("third", data));
    const listing = await shell.exec("tar tvf -", { stdin: bytes });
    assert.equal(listing.exitCode, 0, listing.stderr);
    assert.equal(listing.stdout, "-rw-r--r-- -/- 517 - first\n-rw-r--r-- -/- 517 - second\n-rw-r--r-- -/- 517 1700000100.25 third\n");
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    for (const name of ["first", "second"]) assert.equal((await fs.stat(`/out/${name}`)).mtimeMs, createdMtime);
    assert.deepEqual(calls, [{ path: "/out/third", atime: globalTime * 1000, mtime: globalTime * 1000 }]);
  } finally { await shell.dispose(); }
});

test("D03 duplicate deletion and reintroduction use the last per-key record", async () => {
  const { fs, shell } = await observed();
  try {
    const bytes = archive(extended("g", ["mtime", String(globalTime)], ["mtime", ""], ["uid", "23"]), extended("g", ["mtime", ""]), extended("x", ["mtime", ""], ["mtime", String(localTime)]), extended("x", ["gid", "45"]), member("local", data), extended("x", ["mtime", String(localTime)], ["mtime", ""]), member("deleted", data), extended("g", ["mtime", ""], ["mtime", String(globalTime)]), member("global", data));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/out/local")).mtimeMs, localTime * 1000);
    assert.equal((await fs.stat("/out/deleted")).mtimeMs, createdMtime);
    assert.equal((await fs.stat("/out/global")).mtimeMs, globalTime * 1000);
    assert.match((await shell.exec("tar tvf -", { stdin: bytes })).stdout, /23\/45 517 1700000200.5 local/u);
  } finally { await shell.dispose(); }
});

test("D04 local state is consumed by excluded members without mutating global deletion", async () => {
  const { fs, shell } = await observed();
  try {
    const bytes = archive(extended("g", ["mtime", ""]), extended("x", ["mtime", String(localTime)]), member("skip", data), member("kept", data), extended("x", ["mtime", String(localTime)]), member("temporary", data), member("resumed", data));
    const result = await shell.exec("tar xf - -C /out --exclude=skip", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(fs.stat("/out/skip"), { code: "ENOENT" });
    for (const name of ["kept", "resumed"]) assert.equal((await fs.stat(`/out/${name}`)).mtimeMs, createdMtime);
    assert.equal((await fs.stat("/out/temporary")).mtimeMs, localTime * 1000);
  } finally { await shell.dispose(); }
});

test("D05 deleted required path rejects before effects and cannot resurrect GNU names", async () => {
  for (const type of ["x", "g"] as const) {
    await rejected(archive(member("long", Buffer.from("gnu-name\0"), "L"), extended(type, ["path", ""]), member("keep", data)), /missing effective path/u);
  }
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(extended("g", ["path", ""]), extended("x", ["path", "restored"]), member("raw", data));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/restored"), data);
  } finally { await shell.dispose(); }
});

test("D06 deleted regular size fails even when excluded and reintroduction preserves alignment", async () => {
  await rejected(archive(extended("x", ["size", ""]), member("keep", data)), /missing effective size/u, ["--exclude=keep"]);
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(extended("g", ["size", ""]), extended("x", ["size", "517"]), mutated("first", bytes => bytes.fill(0, 124, 136)), extended("x", ["size", "3"]), member("next", Uint8Array.of(7, 8, 9)));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/first"), data);
    assert.deepEqual(await fs.readFile("/out/next"), Uint8Array.of(7, 8, 9));
    const limited = await direct(["tf", "-"], fs, { stdin: source(bytes) }, { limits: { maxEntryBytes: 516 } });
    assert.notEqual(limited.exitCode, 0);
    assert.match(limited.stderr, /limit/u);
  } finally { await shell.dispose(); }
});

test("D07 link deletion blocks raw and GNU targets while restored hardlinks share identity", async () => {
  for (const type of ["1", "2"]) await rejected(archive(member("long", Buffer.from("keep\0"), "K"), extended("x", ["linkpath", ""]), member("link", Buffer.alloc(0), type, "keep")), /missing effective linkpath/u);
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("target", data), extended("g", ["linkpath", ""]), extended("x", ["linkpath", "target"]), member("hard", Buffer.alloc(0), "1", "raw"));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    const target = await fs.stat("/out/target"), hard = await fs.stat("/out/hard");
    assert.notEqual(target.identityScope, undefined);
    assert.equal(hard.identityScope, target.identityScope);
    assert.equal(hard.dev, target.dev);
    assert.equal(hard.ino, target.ino);
    await fs.appendFile("/out/hard", Uint8Array.of(99));
    assert.deepEqual(Buffer.from(await fs.readFile("/out/target")), Buffer.concat([data, Uint8Array.of(99)]));
  } finally { await shell.dispose(); }
});

test("D08 deleted mtime preserves deterministic file and deferred-directory backend state", async () => {
  const { fs, shell, calls } = await observed();
  try {
    const bytes = archive(extended("g", ["mtime", ""]), member("file", data), member("directory", Buffer.alloc(0), "5"));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    for (const name of ["file", "directory"]) {
      const stat = await fs.stat(`/out/${name}`);
      assert.equal(stat.atimeMs, createdAtime);
      assert.equal(stat.mtimeMs, createdMtime);
    }
    assert.deepEqual(calls, []);
  } finally { await shell.dispose(); }
});

test("D09 paired timestamp restoration preserves the missing counterpart and propagates errors", async () => {
  for (const [pairs, atime, mtime] of [
    [[["mtime", ""], ["atime", String(localTime)]], localTime * 1000, createdMtime],
    [[["mtime", String(localTime)], ["atime", ""]], createdAtime, localTime * 1000],
    [[["mtime", ""], ["atime", ""]], createdAtime, createdMtime],
    [[["mtime", String(localTime)]], localTime * 1000, localTime * 1000],
  ] as [Array<[string, string]>, number, number][]) {
    const { fs, shell, calls } = await observed();
    try {
      const result = await shell.exec("tar xf - -C /out", { stdin: archive(extended("x", ...pairs), member("file", data)) });
      assert.equal(result.exitCode, 0, result.stderr);
      const stat = await fs.stat("/out/file");
      assert.equal(stat.atimeMs, atime);
      assert.equal(stat.mtimeMs, mtime);
      assert.deepEqual(calls, atime === createdAtime && mtime === createdMtime ? [] : [{ path: "/out/file", atime, mtime }]);
    } finally { await shell.dispose(); }
  }
  for (const stage of ["stat", "utimes"]) for (const abort of [false, true]) {
    const { fs, shell } = await observed();
    const originalStat = fs.stat.bind(fs);
    const controller = new AbortController();
    const reason = new Error("deleted-time cancellation");
    const deny = () => {
      if (abort) controller.abort(reason);
      throw new Error("deleted-time observation denied");
    };
    try {
      if (stage === "stat") fs.stat = async (path, options) => {
        if (path === "/out/file") deny();
        return originalStat(path, options);
      };
      else fs.utimes = async () => deny();
      const execution = direct(["xf", "-", "-C", "/out"], fs, { signal: controller.signal, stdin: source(archive(extended("x", ["mtime", ""], ["atime", String(localTime)]), member("file", data), member("later", data))) });
      if (abort) await assert.rejects(execution, error => error === reason);
      else {
        const result = await execution;
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, /deleted-time observation denied/u);
      }
      assert.deepEqual(await fs.readFile("/out/file"), data);
      await assert.rejects(fs.lstat("/out/later"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
  }
});

test("D10 effective PAX and GNU paths mask only unselected raw semantic fields", async () => {
  const invalid = (bytes: Buffer) => { bytes[0] = 255; bytes[345] = 255; bytes[157] = 255; };
  for (const metadata of [extended("x", ["path", "safe"], ["linkpath", "target"]), Buffer.concat([member("long", Buffer.from("safe\0"), "L"), member("long", Buffer.from("target\0"), "K")])]) {
    const { fs, shell } = await fixture();
    try {
      const bytes = archive(member("target", data), metadata, mutated("bad", invalid, "2", "bad", Buffer.alloc(0)));
      const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await fs.readlink!("/out/safe"), "target");
    } finally { await shell.dispose(); }
  }
  await rejected(archive(mutated("bad", invalid)), /UTF-8/u);
  await rejected(archive(extended("x", ["path", "../escape"]), member("keep", data)), /parent/u, [], ["-xf"]);
  await rejected(archive(extended("x", ["path", "safe"], ["linkpath", "/outside"]), member("bad", Buffer.alloc(0), "2", "keep")), /symlink target escapes extraction root/u, [], ["-xf"]);
});

test("D11 selected numeric PAX values bypass malformed raw numbers but retain effective validation", async () => {
  const invalid = (bytes: Buffer) => { for (const [offset, width] of [[108, 8], [116, 8], [124, 12], [136, 12]]) bytes.fill(57, offset!, offset! + width!); };
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(extended("x", ["uid", "12"], ["gid", "34"], ["size", "517"], ["mtime", String(localTime)]), mutated("file", invalid));
    const listing = await shell.exec("tar tvf -", { stdin: bytes });
    assert.equal(listing.exitCode, 0, listing.stderr);
    assert.equal(listing.stdout, "-rw-r--r-- 12/34 517 1700000200.5 file\n");
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/file"), data);
    const deleted = archive(extended("x", ["uid", ""], ["gid", ""], ["size", "517"], ["mtime", ""]), mutated("file", invalid));
    const missing = await shell.exec("tar tvf -", { stdin: deleted });
    assert.equal(missing.exitCode, 0, missing.stderr);
    assert.equal(missing.stdout, "-rw-r--r-- -/- 517 - file\n");
  } finally { await shell.dispose(); }
  await rejected(archive(mutated("keep", invalid)), /numeric|octal/u);
  for (const [key, value] of [["size", "-1"], ["uid", "9007199254740992"], ["mtime", "NaN"]]) await rejected(archive(extended("x", [key!, value!]), member("keep", data)), /invalid PAX/u);
});

test("D12 tombstones retain structural, framing, critical-layout and resource guards", async () => {
  const damaged = member("keep", data);
  damaged[0] = 255;
  const badExtension = member("metadata", record("mtime", ""), "x");
  badExtension.fill(57, 124, 136); checksum(badExtension);
  const cases: [Buffer, RegExp][] = [
    [archive(extended("x", ["path", "safe"]), damaged), /checksum/u],
    [archive(extended("g", ["size", "0"]), badExtension), /octal/u],
    [archive(member("metadata", Buffer.from("15 mtime=\n"), "x"), member("keep", data)), /PAX/u],
    [archive(extended("x", ["mtime", ""])), /orphan/u],
    [archive(extended("x", ["GNU.sparse.size", ""], ["GNU.sparse.size", "0"], ["mtime", ""]), member("keep", data)), /unsupported PAX/u],
    [archive(extended("x", ["hdrcharset", "BINARY"], ["hdrcharset", ""], ["mtime", ""]), member("keep", data)), /charset/u],
  ];
  for (const [bytes, diagnostic] of cases) await rejected(bytes, diagnostic);
  const { fs, shell } = await fixture();
  try {
    for (const limits of [{ maxPaxBytes: 4 }, { maxMembers: 1 }, { maxEntryBytes: 516 }, { maxTotalBytes: 516 }]) {
      const result = await direct(["xf", "-", "-C", "/out"], fs, { stdin: source(archive(extended("g", ["mtime", ""]), member("keep", data))) }, { limits });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /limit/u);
      assert.deepEqual(await fs.readdir("/out"), []);
    }
  } finally { await shell.dispose(); }
});
