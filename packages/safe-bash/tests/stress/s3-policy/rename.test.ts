import assert from "node:assert/strict";
import test from "node:test";
import { FsError, isFsError } from "../../../src/contracts/errors.js";
import {
  createS3Transport, MockS3Client, S3FileSystem, S3RenameError, S3ServiceError,
} from "../../../src/fs/s3/index.js";
import type {
  S3CopyInput, S3DeleteInput, S3FileSystemOptions, S3RequestOptions,
  S3Transport, S3TransportCapabilities,
} from "../../../src/fs/s3/index.js";

const bucket = "rename-policy";
const bytes = (value: string) => new TextEncoder().encode(value);
const settings = { timeout: 5_000 };
type Operation = "copy" | "delete";
type Hook = (operation: Operation, key: string, occurrence: number) => Promise<void>;

async function fixture(initial: Record<string, string>, capabilities?: S3TransportCapabilities,
  options: Partial<Omit<S3FileSystemOptions, "transport" | "bucket">> = {}) {
  const client = new MockS3Client({ buckets: [bucket], pageSize: 2, now: () => new Date(1_700_000_000_000) });
  for (const [Key, value] of Object.entries(initial)) await client.putObject({ Bucket: bucket, Key, Body: bytes(value) });
  const base = createS3Transport(client, capabilities ?? client.capabilities);
  let before: Hook = async () => {};
  let after: Hook = async () => {};
  let confirmCopy = true;
  const calls: { operation: Operation; input: S3CopyInput | S3DeleteInput }[] = [];
  const counts = { copy: 0, delete: 0 };
  const transport: S3Transport = {
    ...base,
    async copyObject(input: S3CopyInput, request?: S3RequestOptions) {
      calls.push({ operation: "copy", input: structuredClone(input) });
      const occurrence = ++counts.copy;
      await before("copy", input.Key, occurrence);
      const result = await base.copyObject(input, request);
      await after("copy", input.Key, occurrence);
      return confirmCopy ? result : {};
    },
    async deleteObject(input: S3DeleteInput, request?: S3RequestOptions) {
      calls.push({ operation: "delete", input: structuredClone(input) });
      const occurrence = ++counts.delete;
      await before("delete", input.Key, occurrence);
      const result = await base.deleteObject(input, request);
      await after("delete", input.Key, occurrence);
      return result;
    },
  };
  const fs = new S3FileSystem({ transport, bucket, pageSize: 2, ...options });
  return {
    fs, client, calls,
    before(hook: Hook) { before = hook; },
    after(hook: Hook) { after = hook; },
    unconfirmedCopy() { confirmCopy = false; },
    async put(Key: string, value: string) { await client.putObject({ Bucket: bucket, Key, Body: bytes(value) }); },
    async state() {
      const result: Record<string, string> = {};
      let token: string | undefined;
      do {
        const listing = await client.listObjectsV2({ Bucket: bucket, ...(token ? { ContinuationToken: token } : {}) });
        for (const item of listing.Contents ?? []) {
          assert.ok(item.Key);
          const output = await client.getObject({ Bucket: bucket, Key: item.Key });
          assert.ok(output.Body instanceof Uint8Array);
          result[item.Key] = new TextDecoder().decode(output.Body);
        }
        token = listing.NextContinuationToken;
      } while (token);
      return result;
    },
  };
}

async function outcome(operation: Promise<void>): Promise<unknown> {
  try { await operation; return undefined; }
  catch (error) { return error; }
}

function partial(error: unknown, phase: Operation, code: string, copied: string[], deleted: string[]) {
  assert.ok(error instanceof S3RenameError, `expected explicit partial-state error, received ${String(error)}`);
  assert.equal(error.phase, phase);
  assert.equal(error.code, code);
  assert.equal(error.syscall, "rename");
  assert.equal(error.path, "/source");
  assert.equal(error.dest, "/target");
  assert.ok(error.cause instanceof FsError);
  assert.deepEqual(error.copiedKeys, copied);
  assert.deepEqual(error.deletedKeys, deleted);
  assert.ok(Object.isFrozen(error.copiedKeys));
  assert.ok(Object.isFrozen(error.deletedKeys));
}

test("default guarded rename succeeds and advertises non-atomic semantics", settings, async () => {
  const setup = await fixture({ source: "original", unrelated: "keep" });
  await setup.fs.rename("/source", "/target");
  assert.equal(setup.fs.capabilities.atomicRename, false);
  assert.deepEqual(await setup.state(), { target: "original", unrelated: "keep" });
  assert.deepEqual(setup.calls.map(call => call.operation), ["copy", "delete"]);
  const copy = setup.calls[0]!.input as S3CopyInput;
  assert.equal(copy.IfNoneMatch, "*");
  assert.ok(copy.CopySourceIfMatch);
  assert.equal((setup.calls[1]!.input as S3DeleteInput).IfMatch, copy.CopySourceIfMatch);
});

test("stable existing destination is legitimately replaced with destination ETag guard", settings, async () => {
  const setup = await fixture({ source: "original", target: "old destination" });
  const previous = await setup.client.headObject({ Bucket: bucket, Key: "target" });
  await setup.fs.rename("/source", "/target");
  assert.deepEqual(await setup.state(), { target: "original" });
  assert.equal((setup.calls[0]!.input as S3CopyInput).IfMatch, previous.ETag);
});

test("explicit atomic-policy opt-out rejects before host effects", settings, async () => {
  const setup = await fixture({ source: "original" }, undefined, { allowNonAtomicRename: false });
  const requestCount = setup.client.requests.length;
  await assert.rejects(setup.fs.rename("/source", "/target"), error => isFsError(error, "ENOTSUP"));
  assert.equal(setup.client.requests.length, requestCount);
  assert.deepEqual(await setup.state(), { source: "original" });
});

for (const capabilities of [{}, { conditionalCopy: true }, { conditionalDelete: true }, { conditionalCopy: false, conditionalDelete: true }]) {
  test(`minimum mutation capabilities preflight ${JSON.stringify(capabilities)}`, settings, async () => {
    const setup = await fixture({ source: "original", target: "keep" }, capabilities);
    const error = await outcome(setup.fs.rename("/source", "/target"));
    console.log(JSON.stringify({ resolved: error === undefined, code: error instanceof FsError ? error.code : null, calls: setup.calls, state: await setup.state() }));
    assert.deepEqual(await setup.state(), { source: "original", target: "keep" }, "missing negotiated guards must not mutate either key");
    assert.equal(setup.calls.length, 0);
    assert.ok(isFsError(error, "ENOTSUP"));
  });
}

test("no destination guard capability must not clobber concurrent create", settings, async () => {
  const setup = await fixture({ source: "original" }, { conditionalDelete: true });
  setup.before(async operation => { if (operation === "copy") await setup.put("target", "concurrent writer"); });
  const error = await outcome(setup.fs.rename("/source", "/target"));
  console.log(JSON.stringify({ resolved: error === undefined, calls: setup.calls, state: await setup.state() }));
  assert.deepEqual(await setup.state(), { source: "original" }, "reject capability before invoking even the copy hook");
  assert.ok(isFsError(error, "ENOTSUP"));
  assert.equal(setup.calls.length, 0);
});

for (const existing of [false, true]) {
  test(`destination ${existing ? "replacement" : "creation"} race retains both current writers`, settings, async () => {
    const initial: Record<string, string> = { source: "original", ...(existing ? { target: "old" } : {}) };
    const setup = await fixture(initial);
    setup.before(async operation => { if (operation === "copy") await setup.put("target", "concurrent writer"); });
    const error = await outcome(setup.fs.rename("/source", "/target"));
    console.log(JSON.stringify({ resolved: error === undefined, state: await setup.state() }));
    partial(error, "copy", "EAGAIN", [], []);
    assert.deepEqual(await setup.state(), { source: "original", target: "concurrent writer" });
    assert.equal(setup.calls.filter(call => call.operation === "delete").length, 0);
  });
}

for (const stage of ["copy", "delete"] as const) {
  test(`changed source before ${stage} is never deleted`, settings, async () => {
    const setup = await fixture({ source: "original" });
    setup.before(async operation => { if (operation === stage) await setup.put("source", "new bytes"); });
    partial(await outcome(setup.fs.rename("/source", "/target")), stage, "EAGAIN", stage === "delete" ? ["target"] : [], []);
    assert.deepEqual(await setup.state(), { source: "new bytes", ...(stage === "delete" ? { target: "original" } : {}) });
  });
}

test("deleted and recreated source with different bytes survives guarded deletion", settings, async () => {
  const setup = await fixture({ source: "original" });
  setup.before(async operation => {
    if (operation !== "delete") return;
    await setup.client.deleteObject({ Bucket: bucket, Key: "source" });
    await setup.put("source", "new incarnation");
  });
  partial(await outcome(setup.fs.rename("/source", "/target")), "delete", "EAGAIN", ["target"], []);
  assert.deepEqual(await setup.state(), { source: "new incarnation", target: "original" });
});

const directory = { "source/": "", "source/alpha": "A", "source/beta": "B", unrelated: "keep" };
const sourceKeys = ["source/", "source/alpha", "source/beta"];
const destinationKeys = ["target/", "target/alpha", "target/beta"];

test("paginated directory move completes every copy before any delete", settings, async () => {
  const setup = await fixture(directory);
  await setup.fs.rename("/source", "/target");
  assert.deepEqual(setup.calls.map(call => call.operation), ["copy", "copy", "copy", "delete", "delete", "delete"]);
  assert.deepEqual(await setup.state(), { "target/": "", "target/alpha": "A", "target/beta": "B", unrelated: "keep" });
});

for (const stage of ["copy", "delete"] as const) {
  for (const failureIndex of [1, 2, 3]) {
    test(`${stage} failure ${failureIndex}/3 reports acknowledged partial directory state`, settings, async () => {
      const setup = await fixture(directory);
      setup.before(async (operation, _key, occurrence) => {
        if (operation === stage && occurrence === failureIndex) throw new S3ServiceError("AccessDenied", 403);
      });
      const error = await outcome(setup.fs.rename("/source", "/target"));
      const copies = stage === "copy" ? failureIndex - 1 : 3;
      const deletes = stage === "delete" ? failureIndex - 1 : 0;
      partial(error, stage, "EACCES", destinationKeys.slice(0, copies), sourceKeys.slice(0, deletes));
      const expected: Record<string, string> = { ...directory };
      for (const key of sourceKeys.slice(0, deletes)) delete expected[key];
      for (const key of sourceKeys.slice(0, copies)) expected[key.replace("source", "target")] = directory[key as keyof typeof directory];
      assert.deepEqual(await setup.state(), expected);
      if (stage === "copy") assert.equal(setup.calls.filter(call => call.operation === "delete").length, 0);
    });
  }
}

for (const [service, status, expected] of [
  ["PreconditionFailed", 412, "EAGAIN"], ["ConditionalRequestConflict", 409, "EAGAIN"],
  ["NoSuchKey", 404, "ENOENT"], ["RequestTimeout", 408, "ETIMEDOUT"], ["InternalError", 500, "EIO"],
] as const) {
  test(`copy rejection ${service} preserves source and typed cause`, settings, async () => {
    const setup = await fixture({ source: "original" });
    setup.before(async () => { throw new S3ServiceError(service, status); });
    partial(await outcome(setup.fs.rename("/source", "/target")), "copy", expected, [], []);
    assert.deepEqual(await setup.state(), { source: "original" });
  });
}

test("unconfirmed copy response never authorizes source deletion", settings, async () => {
  const setup = await fixture({ source: "original" });
  setup.unconfirmedCopy();
  partial(await outcome(setup.fs.rename("/source", "/target")), "copy", "EIO", [], []);
  assert.deepEqual(await setup.state(), { source: "original", target: "original" });
  assert.equal(setup.calls.filter(call => call.operation === "delete").length, 0);
});

for (const stage of ["copy", "delete"] as const) {
  test(`lost ${stage} acknowledgement rejects rather than reporting success`, settings, async () => {
    const setup = await fixture({ source: "original" });
    setup.after(async operation => { if (operation === stage) throw new S3ServiceError("RequestTimeout", 408); });
    partial(await outcome(setup.fs.rename("/source", "/target")), stage, "ETIMEDOUT", stage === "copy" ? [] : ["target"], []);
    assert.deepEqual(await setup.state(), { ...(stage === "copy" ? { source: "original" } : {}), target: "original" });
  });
  test(`abort during ${stage} preserves acknowledged state and propagates signal`, settings, async () => {
    const setup = await fixture({ source: "original" });
    const controller = new AbortController();
    setup.before(async operation => { if (operation === stage) controller.abort(new Error("deterministic cancellation")); });
    partial(await outcome(setup.fs.rename("/source", "/target", { signal: controller.signal })), stage, "ECANCELED", stage === "copy" ? [] : ["target"], []);
    assert.deepEqual(await setup.state(), { source: "original", ...(stage === "delete" ? { target: "original" } : {}) });
  });
}

test("pre-aborted rename performs no mutation", settings, async () => {
  const setup = await fixture({ source: "original" });
  await assert.rejects(setup.fs.rename("/source", "/target", { signal: AbortSignal.abort() }), error => isFsError(error, "ECANCELED"));
  assert.equal(setup.calls.length, 0);
  assert.deepEqual(await setup.state(), { source: "original" });
});

test("new source child after enumeration is retained, not included in bulk deletion", settings, async () => {
  const setup = await fixture(directory);
  setup.before(async (operation, _key, occurrence) => {
    if (operation === "delete" && occurrence === 1) await setup.put("source/new", "concurrent writer");
  });
  await setup.fs.rename("/source", "/target");
  assert.deepEqual(await setup.state(), { "source/new": "concurrent writer", "target/": "", "target/alpha": "A", "target/beta": "B", unrelated: "keep" });
  assert.ok(setup.calls.filter(call => call.operation === "delete").every(call => call.input.Key !== "source/new"));
});

test("prefix isolation and encoded Unicode keys preserve unrelated objects", settings, async () => {
  const setup = await fixture({ "prefix/source ü?": "binary\u0000bytes", "outside/source ü?": "keep" }, undefined, { prefix: "prefix" });
  await setup.fs.rename("/source ü?", "/target #");
  assert.deepEqual(await setup.state(), { "prefix/target #": "binary\u0000bytes", "outside/source ü?": "keep" });
  assert.equal((setup.calls[0]!.input as S3CopyInput).CopySource, "rename-policy/prefix/source%20%C3%BC%3F");
});

test("same-path default rename succeeds without copy or deletion", settings, async () => {
  const setup = await fixture({ source: "original" });
  await setup.fs.rename("/source", "/source");
  assert.equal(setup.calls.length, 0);
  assert.deepEqual(await setup.state(), { source: "original" });
});

for (const stage of ["copy", "delete"] as const) {
  test(`concurrent source removal before ${stage} reports explicit partial state`, settings, async () => {
    const setup = await fixture({ source: "original" });
    setup.before(async operation => { if (operation === stage) await setup.client.deleteObject({ Bucket: bucket, Key: "source" }); });
    partial(await outcome(setup.fs.rename("/source", "/target")), stage, "ENOENT", stage === "delete" ? ["target"] : [], []);
    assert.deepEqual(await setup.state(), stage === "delete" ? { target: "original" } : {});
  });
}

test("concurrent destination child blocks its copy without deleting any source keys", settings, async () => {
  const setup = await fixture(directory);
  setup.before(async (operation, key) => { if (operation === "copy" && key === "target/alpha") await setup.put(key, "new destination child"); });
  const error = await outcome(setup.fs.rename("/source", "/target"));
  console.log(JSON.stringify({ resolved: error === undefined, state: await setup.state() }));
  partial(error, "copy", "EAGAIN", ["target/"], []);
  assert.deepEqual(await setup.state(), { ...directory, "target/": "", "target/alpha": "new destination child" });
});

test("changed later source child remains after earlier conditional deletions", settings, async () => {
  const setup = await fixture(directory);
  setup.before(async (operation, key) => { if (operation === "delete" && key === "source/beta") await setup.put(key, "new source child"); });
  partial(await outcome(setup.fs.rename("/source", "/target")), "delete", "EAGAIN", destinationKeys, sourceKeys.slice(0, 2));
  assert.deepEqual(await setup.state(), { "source/beta": "new source child", "target/": "", "target/alpha": "A", "target/beta": "B", unrelated: "keep" });
});

for (const [source, target, code] of [
  ["/source", "/source/nested", "EINVAL"], ["/missing", "/target", "ENOENT"],
  ["/source/alpha", "/source", "EISDIR"], ["/source", "/source/alpha", "EINVAL"],
] as const) {
  test(`structural preflight ${source} to ${target} returns ${code} without mutation`, settings, async () => {
    const setup = await fixture(directory);
    await assert.rejects(setup.fs.rename(source, target), error => isFsError(error, code));
    assert.equal(setup.calls.length, 0);
    assert.deepEqual(await setup.state(), directory);
  });
}
