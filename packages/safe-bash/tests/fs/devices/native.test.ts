import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import test from "node:test";
import { collectBytes, FsError, toByteSource } from "poe-code/safe-fs";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";

interface ArchivedText {
  readonly sha256: string;
  readonly raw: string;
}

interface Capture extends ArchivedText {
  readonly id: string;
  readonly source: { readonly sha256: string; readonly text: string };
}

interface Reference {
  readonly format: number;
  readonly profile: string;
  readonly captures: readonly Capture[];
  readonly historical: {
    readonly originalTest: { readonly sha256: string; readonly source: string };
    readonly taps: readonly ArchivedText[];
    readonly retrospectiveTapAuthentication: ArchivedText;
    readonly executionBinding: string;
    readonly reclassification: string;
  };
}

interface Receipt {
  readonly records: readonly Record<string, unknown>[];
  readonly pre?: { readonly source: { readonly sha256: string } };
  readonly post?: { readonly source: { readonly sha256: string } };
  readonly sourceBefore?: { readonly sha256: string };
  readonly sourceAfter?: { readonly sha256: string };
}

const fixturePath = new URL("./native-reference.json", import.meta.url);
const fixtureHandle = openSync(fixturePath, constants.O_RDONLY | constants.O_NOFOLLOW);
let fixtureBytes: Buffer;
try {
  const metadata = fstatSync(fixtureHandle);
  assert.ok(metadata.isFile());
  assert.ok(metadata.size > 0 && metadata.size <= 512 * 1024);
  fixtureBytes = Buffer.alloc(metadata.size);
  let offset = 0;
  while (offset < fixtureBytes.length) {
    const count = readSync(fixtureHandle, fixtureBytes, offset, fixtureBytes.length - offset, offset);
    assert.ok(count > 0, "Truncated immutable native reference");
    offset += count;
  }
  assert.equal(fstatSync(fixtureHandle).size, metadata.size);
} finally { closeSync(fixtureHandle); }
assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "a1aedcc6aaf493964a9379e8a0f340f4b224f6b1c12d9eb86446428139c2ae80");
const reference = JSON.parse(fixtureBytes.toString("utf8")) as Reference;
assert.equal(reference.format, 1);
const receipts = new Map<string, Receipt>();
for (const capture of reference.captures) {
  assert.ok(!receipts.has(capture.id));
  assert.equal(createHash("sha256").update(capture.raw).digest("hex"), capture.sha256);
  assert.equal(createHash("sha256").update(capture.source.text).digest("hex"), capture.source.sha256);
  const receipt = JSON.parse(capture.raw) as Receipt;
  assert.equal(receipt.pre?.source.sha256 ?? receipt.sourceBefore?.sha256, capture.source.sha256);
  assert.equal(receipt.post?.source.sha256 ?? receipt.sourceAfter?.sha256, capture.source.sha256);
  assert.ok(Array.isArray(receipt.records) && receipt.records.length <= 200);
  receipts.set(capture.id, receipt);
}
assert.deepEqual([...receipts.keys()], ["A", "B", "C", "D", "E", "F"]);

function record(capture: string, fields: Record<string, string | number>): Record<string, unknown> {
  const candidates = receipts.get(capture)!.records.filter(row => Object.entries(fields).every(([key, value]) => row[key] === value));
  assert.equal(candidates.length, 1, `Missing or ambiguous ${capture} native record: ${JSON.stringify(fields)}`);
  return candidates[0]!;
}

function number(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  assert.ok(typeof value === "number" && Number.isSafeInteger(value), `Invalid numeric native field ${key}`);
  return value;
}

test("frozen Darwin native references preserve source/TAP provenance without claiming the old execution binding", () => {
  const history = reference.historical;
  assert.equal(history.originalTest.sha256, "d1c0ef3e12f925f7da65312fd4ef4566dee914dbba63e0764f70edd742bb9593");
  assert.equal(createHash("sha256").update(history.originalTest.source).digest("hex"), history.originalTest.sha256);
  for (const archived of [...history.taps, history.retrospectiveTapAuthentication]) {
    assert.equal(createHash("sha256").update(archived.raw).digest("hex"), archived.sha256);
  }
  assert.ok(history.executionBinding.includes("No such connection is inferred"));
  assert.ok(history.reclassification.includes("diagnostic only"));
  const summary = record("F", { operation: "summary" });
  assert.equal(summary.opened, 4);
  assert.equal(summary.closed, 4);
  assert.equal(summary.readCalls, 4);
  assert.equal(summary.requestedBytes, 1024);
  assert.equal(summary.malformedCalls, 5);
  assert.equal(summary.deviceWriteCalls, 0);
});

const names = ["null", "zero", "random", "urandom"] as const;
for (const name of names) {
  test(`frozen Darwin ${name}: metadata/access and RW append read256`, async context => {
    const fs = createDeviceFileSystem();
    const path = `/${name}`;
    const node = `/dev/${name}`;
    const identity = record("F", { operation: "identity", node });
    const opened = record("F", { operation: "open", node });
    const flags = record("F", { operation: "constants" });
    const requiredFlags = number(flags, "O_RDWR") | number(flags, "O_APPEND") | number(flags, "O_NONBLOCK");
    assert.equal(opened.requestedFlags, requiredFlags);
    assert.equal(opened.success, true);
    assert.equal(opened.errno, 0);
    assert.equal(number(identity, "flags") & requiredFlags, requiredFlags);
    assert.equal(identity.sameNode, true);
    const stat = await fs.lstat(path);
    assert.equal(stat.type, "character");
    assert.equal(stat.mode, number(identity, "mode"));
    assert.equal(stat.size, number(identity, "size"));
    for (const [operation, mode] of [["access-read", 4], ["access-write", 2]] as const) {
      const access = record("A", { operation, device: name });
      assert.equal(access.result, 0);
      assert.equal(access.errno, 0);
      await fs.access(path, mode);
    }
    const descriptor = await fs.open(path, { access: "readwrite", append: true });
    context.after(() => descriptor.close());
    assert.deepEqual(await descriptor.stat(), stat);
    const read = record("F", { operation: "read", node });
    assert.equal(read.errno, 0);
    assert.equal(await descriptor.getPosition!(), number(read, "cursorBefore"));
    const bytes = new Uint8Array(number(read, "requested"));
    const returned = await descriptor.read(bytes, null);
    assert.equal(returned, number(read, "returned"));
    assert.equal(await descriptor.getPosition!(), number(read, "cursorAfter"));
    if (name === "zero") {
      assert.equal(read.knownZero, true);
      assert.deepEqual(bytes, new Uint8Array(bytes.length));
    }
    if (name === "null") assert.equal(returned, 0);
    assert.equal(record("F", { operation: "close", node }).returned, 0);
    await descriptor.close();
    await assert.rejects(descriptor.stat(), { code: "EBADF" });
  });

  test(`virtual ${name} stream256 regression against frozen native byte-count/zero-content witness`, async () => {
    const fs = createDeviceFileSystem();
    const read = record("F", { operation: "read", node: `/dev/${name}` });
    const bytes = await collectBytes(fs.readStream(`/${name}`, { endExclusive: 256 }), { maxBytes: 256 });
    assert.equal(bytes.length, number(read, "returned"));
    if (name === "null" || name === "zero") assert.deepEqual(bytes, new Uint8Array(bytes.length));
  });

  test(`virtual ${name} five-byte writes/access6 regression, not a native five-byte witness`, async () => {
    const fs = createDeviceFileSystem();
    const path = `/${name}`;
    const payload = Uint8Array.of(0, 1, 127, 128, 255);
    await fs.access(path, 6);
    const routes = [
      () => fs.writeFile(path, payload),
      () => fs.writeFile(path, payload, { flag: "a" }),
      () => fs.appendFile(path, payload),
      () => fs.writeStream(path, toByteSource(payload), { flag: "a" }),
    ];
    for (const write of routes) {
      if (name === "urandom") await assert.rejects(write(), { code: "EPERM" });
      else await write();
    }
  });

  for (const append of [false, true]) test(`frozen Darwin ${name} one-byte canonical ${append ? "append" : "plain"} write`, async context => {
    const capture = name === "null" || name === "zero" ? "B" : "C";
    const profile = append ? "append" : "plain";
    const observed = record(capture, { device: name, profile, operation: capture === "B" ? "write-1" : "write" });
    const descriptor = await createDeviceFileSystem().open(`/${name}`, { access: "write", append });
    context.after(() => descriptor.close());
    if (number(observed, "errno") === 0) {
      assert.equal(await descriptor.write(Uint8Array.of(0), null), number(observed, capture === "B" ? "result" : "returned"));
    } else {
      assert.equal(observed.errno, record("C", { operation: "constants" }).EPERM);
      await assert.rejects(descriptor.write(Uint8Array.of(0), null), { code: "EPERM" });
    }
  });

  test(`frozen Darwin ${name} explicit zero-byte I/O retains access and device errors`, async context => {
    const fs = createDeviceFileSystem();
    const nativeErrors = record("D", { operation: "constants" });
    for (const access of ["read", "write"] as const) {
      const profile = access === "read" ? "zero-readonly" : "zero-writeonly";
      const descriptor = await fs.open(`/${name}`, { access });
      context.after(() => descriptor.close());
      for (const operation of ["read", "write"] as const) {
        const observed = record("D", { device: name, profile, operation: `${operation}-zero` });
        const execute = () => descriptor[operation](new Uint8Array(), null);
        if (number(observed, "errno") === 0) assert.equal(await execute(), number(observed, "returned"));
        else {
          const expected = observed.errno === nativeErrors.EBADF ? "EBADF" : "EPERM";
          assert.equal(observed.errno, nativeErrors[expected]);
          await assert.rejects(execute(), { code: expected });
        }
      }
    }
  });

  for (const request of [{ size: 65536, offset: -1 }, { size: 65537, offset: -1 },
    { size: 262144, offset: -1 }, { size: 65537, offset: 3 }]) {
    test(`frozen Darwin ${name} large-read count/cursor delta size=${request.size} offset=${request.offset}`, async context => {
      const observed = record("E", { operation: request.offset === -1 ? "read" : "pread", node: `/dev/${name}`, requested: request.size, offset: request.offset });
      assert.equal(observed.errno, 0);
      const descriptor = await createDeviceFileSystem().open(`/${name}`, { access: "read" });
      context.after(() => descriptor.close());
      assert.equal(await descriptor.read(new Uint8Array(request.size), request.offset === -1 ? null : request.offset), number(observed, "returned"));
      assert.equal(await descriptor.getPosition!(), number(observed, "cursorAfter") - number(observed, "cursorBefore"));
    });
  }
}

for (const suffix of ["null/", "zero/.", "random/child", "urandom/../null", "virtual-bash-absent-device/../null"]) {
  test(`frozen Darwin malformed lstat errno: ${suffix}`, async () => {
    const observed = record("F", { operation: "malformed-lstat", path: `/dev/${suffix}` });
    const errors = record("F", { operation: "constants" });
    assert.equal(observed.returned, -1);
    const code = observed.errno === errors.ENOTDIR ? "ENOTDIR" : "ENOENT";
    assert.equal(observed.errno, errors[code]);
    await assert.rejects(createDeviceFileSystem().lstat(`/${suffix}`), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, code);
      return true;
    });
  });
}
