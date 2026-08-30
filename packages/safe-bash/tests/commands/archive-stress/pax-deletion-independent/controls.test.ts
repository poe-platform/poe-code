import assert from "node:assert/strict";
import test from "node:test";
import { archive, backend, checksum, fileData, globalTime, localTime, member, normalAtime, normalMtime, record, run, success, unchangedOutside } from "./helpers.js";

const globalText = "1700200000.125";
const localText = "1700300000.5";
const header = (kind: "x" | "g", ...records: Uint8Array[]) => member("metadata", Buffer.concat(records), kind);
const masked = (...records: Uint8Array[]) => archive(header("x", ...records), member("safe", fileData));

test("D01 local timestamp tombstones mask raw/global once, including excluded real members", async () => {
  for (const exclude of [false, true]) {
    const { fs, state, observe } = await backend();
    const bytes = archive(header("g", record("mtime", globalText)), header("x", record("mtime", "")), member("first", fileData), member("following", fileData));
    success(await run(fs, bytes, ["-xf", "-", "-C", "/out", ...(exclude ? ["--exclude=first"] : [])]));
    if (exclude) await assert.rejects(fs.lstat("/out/first"), { code: "ENOENT" });
    else {
      const first = await observe("/out/first");
      assert.equal(first.mtimeMs, normalMtime);
      assert.equal(first.atimeMs, normalAtime);
    }
    assert.equal((await observe("/out/following")).mtimeMs, globalTime);
    assert.deepEqual(state.times, [{ path: "/out/following", atime: globalTime, mtime: globalTime }]);
    assert.deepEqual(Buffer.from(await fs.readFile("/out/following")), fileData);
    await unchangedOutside(fs);
  }
});

test("D02 global deletion persists per key across unrelated globals and temporary local values", async () => {
  const { fs, state, observe } = await backend();
  const bytes = archive(
    header("g", record("mtime", globalText)), member("initial", fileData),
    header("g", record("mtime", "")), member("deleted", fileData),
    header("g", record("uid", "17")), member("unrelated", fileData),
    header("x", record("mtime", localText)), member("temporary", fileData), member("deleted-again", fileData),
    header("g", record("mtime", "0")), member("zero-value", fileData),
    header("g", record("mtime", globalText)), header("g", record("gid", "19")), member("restored", fileData),
  );
  success(await run(fs, bytes));
  for (const [name, expected] of [["initial", globalTime], ["deleted", normalMtime], ["unrelated", normalMtime], ["temporary", localTime], ["deleted-again", normalMtime], ["zero-value", 0], ["restored", globalTime]] as const) {
    assert.equal((await observe(`/out/${name}`)).mtimeMs, expected, name);
  }
  assert.deepEqual(state.times.map(entry => entry.path), ["/out/initial", "/out/temporary", "/out/zero-value", "/out/restored"]);
  assert.equal((await fs.readdir("/out")).length, 7);
});

test("D03 duplicate records and consecutive local headers use last value without losing tombstones", async () => {
  const cases = [
    { parts: [header("x", record("mtime", globalText), record("mtime", ""), record("mtime", localText))], expected: localTime },
    { parts: [header("x", record("mtime", globalText), record("mtime", ""))], expected: normalMtime },
    { parts: [header("x", record("mtime", ""), record("mtime", "0"))], expected: 0 },
    { parts: [header("x", record("mtime", globalText)), header("x", record("mtime", ""))], expected: normalMtime },
    { parts: [header("g", record("mtime", globalText), record("mtime", ""), record("mtime", localText))], expected: localTime },
  ];
  for (const vector of cases) {
    const { fs, observe } = await backend();
    success(await run(fs, archive(...vector.parts, member("safe", fileData))));
    assert.equal((await observe("/out/safe")).mtimeMs, vector.expected);
  }
});

test("D04 only effective raw fields are decoded and effective sizes preserve following framing", async () => {
  const fields = [
    { name: "path", offsets: [[0, 100], [345, 155]], records: [record("path", "safe")] },
    { name: "size", offsets: [[124, 12]], records: [record("size", "7")] },
    { name: "mtime", offsets: [[136, 12]], records: [record("mtime", globalText)] },
    { name: "ownership", offsets: [[108, 8], [116, 8]], records: [record("uid", "42"), record("gid", "43")] },
  ];
  for (const field of fields) {
    const raw = member("safe", fileData);
    for (const [start, length] of field.offsets) raw.fill(field.name === "mtime" ? 57 : 255, start!, start! + length!);
    checksum(raw);
    const good = await backend();
    success(await run(good.fs, archive(header("x", ...field.records), raw, member("tail", fileData))));
    assert.equal(good.state.publications, 2, field.name);
    assert.deepEqual(Buffer.from(await good.fs.readFile("/out/safe")), fileData);
    assert.deepEqual(Buffer.from(await good.fs.readFile("/out/tail")), fileData);
    const unmasked = await backend();
    assert.equal((await run(unmasked.fs, archive(raw))).exitCode, 2, field.name);
    assert.equal(unmasked.state.publications, 0, field.name);
  }
  const missing = await backend();
  const raw = member("safe", fileData);
  raw.fill(255, 108, 124);
  raw.fill(57, 136, 148);
  checksum(raw);
  const deleted = archive(header("x", record("uid", ""), record("gid", ""), record("mtime", "")), raw);
  success(await run(missing.fs, deleted));
  assert.equal((await missing.observe("/out/safe")).mtimeMs, normalMtime);
  assert.deepEqual(missing.state.times, []);
  const listing = await run(missing.fs, deleted, ["-tvf", "-"]);
  success(listing);
  assert.deepEqual(listing.stdout.trim().split(/\s+/u).slice(1), ["-/-", "7", "-", "safe"]);
  const linked = await backend();
  const linkHeader = member("link", Buffer.alloc(0), "2", "ignored");
  linkHeader.fill(255, 157, 257);
  checksum(linkHeader);
  success(await run(linked.fs, archive(header("x", record("linkpath", "target")), linkHeader, member("tail", fileData))));
  assert.equal(await linked.fs.readlink!("/out/link"), "target");
  assert.deepEqual(Buffer.from(await linked.fs.readFile("/out/tail")), fileData);
  const safe = await backend();
  success(await run(safe.fs, archive(header("x", record("path", "safe")), member("../outside/not-used", fileData))));
  await unchangedOutside(safe.fs);
  const signed = await backend();
  const minusOne = member("safe", fileData);
  minusOne.fill(255, 136, 148);
  checksum(minusOne);
  success(await run(signed.fs, archive(minusOne)));
  assert.equal((await signed.observe("/out/safe")).mtimeMs, -1000);
  assert.deepEqual(signed.state.times, [{ path: "/out/safe", atime: -1000, mtime: -1000 }]);
  assert.deepEqual(Buffer.from(await signed.fs.readFile("/out/safe")), fileData);
});

test("D05 required tombstones reject before member body/effects and cannot resurrect GNU long fallbacks", async () => {
  const vectors = [
    { key: "path", type: "0", link: "", prefix: [] as Buffer[] },
    { key: "path", type: "0", link: "", prefix: [member("long", Buffer.from("long-fallback\0"), "L")] },
    { key: "size", type: "0", link: "", prefix: [] as Buffer[] },
    { key: "size", type: "5", link: "", prefix: [] as Buffer[] },
    { key: "size", type: "2", link: "target", prefix: [] as Buffer[] },
    { key: "linkpath", type: "1", link: "target", prefix: [] as Buffer[] },
    { key: "linkpath", type: "2", link: "target", prefix: [member("long", Buffer.from("long-target\0"), "K")] },
  ];
  for (const vector of vectors) {
    const { fs, state, observe } = await backend();
    await fs.writeFile("/out/keep", Buffer.from("original destination"));
    const before = await observe("/out/keep");
    const payload = vector.type === "0" ? fileData : Buffer.alloc(0);
    const raw = member("keep", payload, vector.type, vector.link);
    const prefix = Buffer.concat([...vector.prefix, header("g", record(vector.key, "")), raw.subarray(0, 512)]);
    let bodyPulls = 0;
    const input = { async *[Symbol.asyncIterator]() { yield prefix; bodyPulls++; yield Buffer.concat([raw.subarray(512), Buffer.alloc(1024)]); } };
    const result = await run(fs, input);
    assert.equal(result.exitCode, 2, `${vector.key}/${vector.type}: ${result.stderr}`);
    assert.ok(result.stderr.length > 0);
    assert.equal(bodyPulls, 0);
    assert.equal(state.publications, 0);
    assert.deepEqual(await observe("/out/keep"), before);
    assert.equal(Buffer.from(await fs.readFile("/out/keep")).toString(), "original destination");
    assert.deepEqual((await fs.readdir("/out")).map(entry => entry.name), ["keep"]);
    await unchangedOutside(fs);
  }
  const ordinary = await backend();
  success(await run(ordinary.fs, masked(record("linkpath", ""))));
  assert.equal((await ordinary.fs.lstat("/out/safe")).type, "file");
  const reintroduced = await backend();
  success(await run(reintroduced.fs, archive(header("g", record("path", ""), record("size", "")), header("x", record("path", "safe"), record("size", "7")), member("ignored", fileData))));
  assert.deepEqual(Buffer.from(await reintroduced.fs.readFile("/out/safe")), fileData);
});

test("D06 paired timestamp restoration preserves deleted counterparts with fresh stat and propagates failure", async () => {
  const cases = [
    { records: [record("mtime", ""), record("atime", localText)], expected: [{ path: "/out/safe", atime: localTime, mtime: normalMtime }], stat: true },
    { records: [record("mtime", globalText), record("atime", "")], expected: [{ path: "/out/safe", atime: normalAtime, mtime: globalTime }], stat: true },
    { records: [record("mtime", ""), record("atime", "")], expected: [], stat: false },
    { records: [record("mtime", globalText)], expected: [{ path: "/out/safe", atime: globalTime, mtime: globalTime }], stat: false },
  ];
  for (const vector of cases) {
    const { fs, state, observe } = await backend();
    success(await run(fs, masked(...vector.records)));
    assert.deepEqual(state.times, vector.expected);
    if (vector.stat) assert.ok(state.postWriteStats.includes("/out/safe"));
    const result = await observe("/out/safe");
    assert.equal(result.atimeMs, vector.expected[0]?.atime ?? normalAtime);
    assert.equal(result.mtimeMs, vector.expected[0]?.mtime ?? normalMtime);
  }
  const failed = await backend();
  failed.state.statError = new Error("independent post-write observation refused");
  const result = await run(failed.fs, masked(record("mtime", ""), record("atime", localText)));
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /independent post-write observation refused/u);
  assert.equal(failed.state.publications, 1);
  assert.deepEqual(failed.state.times, []);
  assert.equal((await failed.observe("/out/safe")).mtimeMs, normalMtime);
  const cancelled = await backend();
  const controller = new AbortController();
  const reason = new Error("independent timestamp observation abort");
  cancelled.state.abortOnStat = { controller, reason };
  await assert.rejects(run(cancelled.fs, masked(record("mtime", ""), record("atime", localText)), undefined, {}, controller.signal), error => error === reason);
  assert.equal(cancelled.state.publications, 1);
  assert.deepEqual(cancelled.state.times, []);
});

test("D07 deletion/overrides never bypass structural framing, strict PAX grammar or byte/path limits", async () => {
  const badChecksum = member("safe", fileData);
  badChecksum[0] = 88;
  const badMagic = member("safe", fileData);
  badMagic.fill(88, 257, 263);
  checksum(badMagic);
  const extensionSize = header("x", record("mtime", ""));
  extensionSize.fill(255, 124, 136);
  checksum(extensionSize);
  const badRecord = record("mtime", "");
  badRecord[badRecord.length - 1] = 33;
  const vectors = [
    archive(header("x", record("path", "safe"), record("mtime", "")), badChecksum),
    archive(header("x", record("path", "safe")), badMagic),
    archive(header("x", record("path", "safe")), member("safe", Buffer.alloc(0), "3")),
    archive(header("g", record("size", "7")), extensionSize, member("safe", fileData)),
    archive(header("x", badRecord), member("safe", fileData)),
    masked(record("GNU.sparse.major", "")),
    masked(record("vendor.layout", "")),
    masked(record("hdrcharset", "BINARY"), record("hdrcharset", "")),
    masked(record("mtime", "1e3"), record("mtime", "")),
    masked(record("path", "../outside/escape"), record("mtime", "")),
    archive(header("x", record("mtime", ""))),
    masked(record("mtime", "1e3")),
    masked(record("mtime", Buffer.from([255])), record("mtime", "")),
    masked(record("mtime", Buffer.from([0])), record("mtime", "")),
  ];
  for (const [index, bytes] of vectors.entries()) {
    const { fs, state, observe } = await backend();
    const result = await run(fs, bytes);
    if (index === 8) {
      success(result);
      assert.equal(state.publications, 1);
      assert.deepEqual(state.times, []);
      const current = await observe("/out/safe");
      assert.equal(current.mtimeMs, normalMtime);
      assert.equal(current.atimeMs, normalAtime);
      assert.deepEqual(Buffer.from(await fs.readFile("/out/safe")), fileData);
      assert.deepEqual((await fs.readdir("/out")).map(entry => entry.name), ["safe"]);
    } else {
      assert.equal(result.exitCode, 2, `D07 mutation ${index}: ${result.stderr}`);
      assert.equal(state.publications, 0);
      assert.deepEqual(await fs.readdir("/out"), []);
    }
    await unchangedOutside(fs);
  }
  const records = Buffer.concat([record("mtime", ""), record("LIBARCHIVE.xattr.user.note", Buffer.from([0, 255, 61, 10]))]);
  const bytes = archive(header("x", records), member("safe", fileData));
  const exact = await backend();
  success(await run(exact.fs, bytes, undefined, { limits: { maxPaxBytes: records.length } }));
  for (const limits of [{ maxPaxBytes: records.length - 1 }, { maxArchiveBytes: 512 }, { maxEntryBytes: 6 }]) {
    const limited = await backend();
    assert.equal((await run(limited.fs, bytes, undefined, { limits })).exitCode, 2);
    assert.equal(limited.state.publications, 0);
  }
  const pathLimit = await backend();
  assert.equal((await run(pathLimit.fs, masked(record("path", "name".repeat(20))), undefined, { limits: { maxPathBytes: 32 } })).exitCode, 2);
  assert.equal(pathLimit.state.publications, 0);
});
