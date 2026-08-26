import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { isFsError } from "../../../src/contracts/errors.js";
import {
  createS3Transport, MockS3Client, S3FileSystem, S3RenameError, S3ServiceError,
} from "../../../src/fs/s3/index.js";
import type { MockS3Request, S3FileSystemOptions, S3TransportCapabilities } from "../../../src/fs/s3/index.js";

const bucket = "rename-policy";
const bytes = (value: string) => new TextEncoder().encode(value);
const settings = { timeout: 5_000 };

async function fixture(initial: Record<string, string>, capabilities: S3TransportCapabilities,
  options: Partial<Omit<S3FileSystemOptions, "transport" | "bucket">> = {}) {
  let before: (request: MockS3Request) => Promise<void> = async () => {};
  const client = new MockS3Client({ buckets: [bucket], pageSize: 2,
    now: () => new Date(1_700_000_000_000), authorize: request => before(request) });
  for (const [Key, value] of Object.entries(initial)) await client.putObject({ Bucket: bucket, Key, Body: bytes(value) });
  const transport = createS3Transport(client, capabilities);
  const fs = new S3FileSystem({ bucket, transport, pageSize: 2, ...options });
  const seededRequests = client.requests.length;
  return {
    fs, client, transport, seededRequests,
    before(hook: typeof before) { before = hook; },
    async put(Key: string, value: string, Metadata?: Record<string, string>) {
      await client.putObject({ Bucket: bucket, Key, Body: bytes(value), ...(Metadata ? { Metadata } : {}) });
    },
    async state() {
      const result: Record<string, string> = {};
      let token: string | undefined;
      do {
        const listing = await client.listObjectsV2({ Bucket: bucket, ...(token ? { ContinuationToken: token } : {}) });
        for (const item of listing.Contents ?? []) {
          const output = await client.getObject({ Bucket: bucket, Key: item.Key! });
          assert.ok(output.Body instanceof Uint8Array);
          result[item.Key!] = new TextDecoder().decode(output.Body);
        }
        token = listing.NextContinuationToken;
      } while (token);
      return result;
    },
  };
}

function partial(phase: "copy" | "delete", code: string, copied: string[], deleted: string[]) {
  return (error: unknown) => {
    assert.ok(error instanceof S3RenameError);
    assert.equal(error.phase, phase);
    assert.equal(error.code, code);
    assert.equal(error.path, "/source");
    assert.equal(error.dest, "/target");
    assert.deepEqual(error.copiedKeys, copied);
    assert.deepEqual(error.deletedKeys, deleted);
    assert.ok(Object.isFrozen(error.copiedKeys));
    assert.ok(Object.isFrozen(error.deletedKeys));
    return true;
  };
}

for (const capabilities of [{ conditionalDelete: true }, { conditionalCopy: false, conditionalDelete: true }]) {
  test(`minimum mutation capabilities preflight ${JSON.stringify(capabilities)}`, settings, async () => {
    const setup = await fixture({ source: "original", target: "keep" }, capabilities);
    await assert.rejects(setup.fs.rename("/source", "/target"), error => isFsError(error, "ENOTSUP"));
    assert.equal(setup.client.requests.length, setup.seededRequests);
    assert.deepEqual(await setup.state(), { source: "original", target: "keep" });
  });
}

test("no destination guard capability must not clobber concurrent create", settings, async () => {
  const setup = await fixture({ source: "original" }, { conditionalDelete: true });
  let mutations = 0;
  setup.before(async request => {
    if (request.operation === "copyObject") {
      mutations++;
      await setup.put("target", "concurrent writer");
    }
    if (request.operation === "putObject" || request.operation === "deleteObject") mutations++;
  });
  await assert.rejects(setup.fs.rename("/source", "/target"), error => isFsError(error, "ENOTSUP"));
  assert.equal(mutations, 0);
  assert.equal(setup.client.requests.length, setup.seededRequests);
  assert.deepEqual(await setup.state(), { source: "original" });
});

test("conditional PUT without conditional current-object deletion rejects before host calls", settings, async () => {
  const setup = await fixture({ source: "original", target: "keep" }, { conditionalPut: true });
  await assert.rejects(setup.fs.rename("/source", "/target"), error => isFsError(error, "ENOTSUP"));
  assert.equal(setup.client.requests.length, setup.seededRequests);
  assert.deepEqual(await setup.state(), { source: "original", target: "keep" });
});

for (const streaming of [false, true]) {
  const capabilities = { conditionalPut: true, conditionalDelete: true, conditionalCopy: false,
    streamingRead: streaming, streamingWrite: streaming };
  const label = streaming ? "streaming" : "buffered";

  for (const existing of [false, true]) {
    test(`${label} PUT rename ${existing ? "replaces stable destination" : "creates destination"} without CopyObject capability`, settings, async () => {
      const setup = await fixture({ source: "original", ...(existing ? { target: "old" } : {}), unrelated: "keep" }, capabilities,
        streaming ? { maxReadBytes: 1, maxStreamBytes: 8 } : {});
      await setup.put("source", "original", { custom: "preserved", "virtual-bash-mtime": "123" });
      const source = await setup.client.headObject({ Bucket: bucket, Key: "source" });
      const target = existing ? await setup.client.headObject({ Bucket: bucket, Key: "target" }) : undefined;
      const requestStart = setup.client.requests.length;
      setup.transport.copyObject = async () => { throw new Error("must not invent conditional CopyObject support"); };
      if (streaming) setup.transport.getObject = async () => { throw new Error("streaming rename must not download through buffered getObject"); };
      await setup.fs.rename("/source", "/target");
      assert.equal(setup.fs.capabilities.atomicRename, false);
      assert.equal(setup.transport.capabilities?.conditionalCopy, false);
      const mutations = setup.client.requests.slice(requestStart).filter(request => ["putObject", "copyObject", "deleteObject"].includes(request.operation));
      assert.deepEqual(mutations.map(request => request.operation), ["putObject", "deleteObject"]);
      const put = mutations[0]!.input;
      if (existing) {
        assert.ok("IfMatch" in put);
        assert.equal(put.IfMatch, target!.ETag);
      } else {
        assert.ok("IfNoneMatch" in put);
        assert.equal(put.IfNoneMatch, "*");
      }
      const deletion = mutations[1]!.input;
      assert.ok("IfMatch" in deletion);
      assert.equal(deletion.IfMatch, source.ETag);
      assert.deepEqual(await setup.state(), { target: "original", unrelated: "keep" });
      assert.equal((await setup.client.headObject({ Bucket: bucket, Key: "target" })).Metadata?.custom, "preserved");
      assert.equal((await setup.fs.stat("/target")).mtimeMs, 123);
    });

    test(`${label} PUT destination ${existing ? "replacement" : "creation"} race retains both writers`, settings, async () => {
      const setup = await fixture({ source: "original", ...(existing ? { target: "old" } : {}) }, capabilities);
      let armed = true;
      setup.before(async request => {
        if (armed && request.operation === "putObject" && "Key" in request.input && request.input.Key === "target") {
          armed = false;
          await setup.put("target", "concurrent writer");
        }
      });
      await assert.rejects(setup.fs.rename("/source", "/target"), partial("copy", "EAGAIN", [], []));
      assert.equal(setup.client.requests.some(request => request.operation === "deleteObject"), false);
      assert.deepEqual(await setup.state(), { source: "original", target: "concurrent writer" });
    });
  }

  test(`${label} PUT source replacement before GET produces no destination`, settings, async () => {
    const setup = await fixture({ source: "original" }, capabilities);
    let armed = true;
    setup.before(async request => {
      if (armed && request.operation === "getObject") {
        armed = false;
        await setup.put("source", "new bytes");
      }
    });
    await assert.rejects(setup.fs.rename("/source", "/target"), partial("copy", "EAGAIN", [], []));
    assert.deepEqual(await setup.state(), { source: "new bytes" });
  });

  test(`${label} PUT changed source after publication survives conditional deletion`, settings, async () => {
    const setup = await fixture({ source: "original" }, capabilities);
    let armed = true;
    setup.before(async request => {
      if (armed && request.operation === "deleteObject") {
        armed = false;
        await setup.put("source", "new bytes");
      }
    });
    await assert.rejects(setup.fs.rename("/source", "/target"), partial("delete", "EAGAIN", ["target"], []));
    assert.deepEqual(await setup.state(), { source: "new bytes", target: "original" });
  });

  test(`${label} PUT deletion failure reports acknowledged publication without rollback`, settings, async () => {
    const setup = await fixture({ source: "original" }, capabilities);
    setup.before(async request => {
      if (request.operation === "deleteObject") throw new S3ServiceError("AccessDenied", 403);
    });
    await assert.rejects(setup.fs.rename("/source", "/target"), partial("delete", "EACCES", ["target"], []));
    assert.deepEqual(await setup.state(), { source: "original", target: "original" });
  });

  test(`${label} PUT lost publication acknowledgement never authorizes source deletion`, settings, async () => {
    const setup = await fixture({ source: "original" }, capabilities);
    if (streaming) {
      const put = setup.transport.putObjectStream!;
      setup.transport.putObjectStream = async (input, options) => {
        await put(input, options);
        throw new S3ServiceError("RequestTimeout", 408);
      };
    } else {
      const put = setup.transport.putObject;
      setup.transport.putObject = async (input, options) => {
        await put(input, options);
        throw new S3ServiceError("RequestTimeout", 408);
      };
    }
    await assert.rejects(setup.fs.rename("/source", "/target"), partial("copy", "ETIMEDOUT", [], []));
    assert.deepEqual(await setup.state(), { source: "original", target: "original" });
    assert.equal(setup.client.requests.some(request => request.operation === "deleteObject"), false);
  });

  test(`${label} PUT directory size preflight rejects before publishing any earlier child`, settings, async () => {
    const setup = await fixture({ "source/": "", "source/a": "A", "source/z": "oversized" }, capabilities,
      { maxReadBytes: 2, maxStreamBytes: 2 });
    await assert.rejects(setup.fs.rename("/source", "/target"), error => isFsError(error, "EFBIG"));
    assert.equal(setup.client.requests.slice(setup.seededRequests).some(request =>
      ["putObject", "copyObject", "deleteObject", "getObject"].includes(request.operation)), false);
    assert.deepEqual(await setup.state(), { "source/": "", "source/a": "A", "source/z": "oversized" });
  });

  test(`${label} PUT supports absent conditionalCopy advertisement without upgrading it`, settings, async () => {
    const { conditionalCopy: _copy, ...withoutCopy } = capabilities;
    const setup = await fixture({ source: "original" }, withoutCopy);
    await setup.fs.rename("/source", "/target");
    assert.equal(setup.transport.capabilities?.conditionalCopy, undefined);
    assert.deepEqual(await setup.state(), { target: "original" });
  });
}

for (const mode of ["copy", "buffered PUT", "streaming PUT"]) {
  const capabilities = { conditionalCopy: mode === "copy", conditionalPut: mode !== "copy", conditionalDelete: true,
    streamingRead: mode === "streaming PUT", streamingWrite: mode === "streaming PUT" };

  test(`LIMIT ${mode}: same-content ABA can delete a new source incarnation with matching ETag`, settings, async () => {
    const setup = await fixture({ source: "original" }, capabilities);
    const original = await setup.client.headObject({ Bucket: bucket, Key: "source" });
    let armed = true;
    setup.before(async request => {
      if (armed && request.operation === "deleteObject") {
        armed = false;
        await setup.client.deleteObject({ Bucket: bucket, Key: "source" });
        await setup.put("source", "original", { incarnation: "new" });
        const replacement = await setup.client.headObject({ Bucket: bucket, Key: "source" });
        assert.equal(replacement.ETag, original.ETag);
        assert.deepEqual(replacement.Metadata, { incarnation: "new" });
      }
    });
    await setup.fs.rename("/source", "/target");
    assert.deepEqual(await setup.state(), { target: "original" });
    assert.deepEqual((await setup.client.headObject({ Bucket: bucket, Key: "target" })).Metadata, {});
    assert.equal(setup.fs.capabilities.atomicRename, false);
  });

  test(`LIMIT ${mode}: a new source child survives successful enumerated-key rename`, settings, async () => {
    const setup = await fixture({ "source/": "", "source/alpha": "A", "source/beta": "B", unrelated: "keep" }, capabilities);
    let armed = true;
    setup.before(async request => {
      if (armed && request.operation === "deleteObject") {
        armed = false;
        await setup.put("source/new", "concurrent writer");
      }
    });
    await setup.fs.rename("/source", "/target");
    assert.deepEqual(await setup.state(), { "source/new": "concurrent writer", "target/": "", "target/alpha": "A", "target/beta": "B", unrelated: "keep" });
    assert.equal((await setup.fs.stat("/source")).type, "directory");
    const mutations = setup.client.requests.slice(setup.seededRequests).filter(request =>
      ["putObject", "copyObject", "deleteObject"].includes(request.operation));
    const firstDelete = mutations.findIndex(request => request.operation === "deleteObject");
    assert.equal(firstDelete, 3);
    assert.ok(mutations.filter(request => request.operation === "deleteObject").every(request =>
      "Key" in request.input && request.input.Key !== "source/new"));
  });
}

test("streaming PUT fallback abort closes a stalled source and never deletes or publishes", settings, async () => {
  const setup = await fixture({ source: "original" }, { conditionalPut: true, conditionalDelete: true, streamingRead: true, streamingWrite: true });
  const head = await setup.client.headObject({ Bucket: bucket, Key: "source" });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let rejectLate!: (error: unknown) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => { rejectLate = reject; });
  let returned = false;
  setup.transport.getObjectStream = async () => ({ ...head, Body: {
    [Symbol.asyncIterator]() { return {
      next() { entered(); return pending; },
      async return() { returned = true; return { done: true, value: undefined }; },
    }; },
  } });
  const controller = new AbortController();
  const operation = setup.fs.rename("/source", "/target", { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(operation, partial("copy", "ECANCELED", [], []));
  rejectLate(new Error("late source failure"));
  await setImmediate();
  assert.equal(returned, true);
  assert.equal(setup.client.requests.some(request => request.operation === "deleteObject"), false);
  assert.deepEqual(await setup.state(), { source: "original" });
});

test("streaming PUT fallback rejects success without full body consumption and closes source", settings, async () => {
  const setup = await fixture({ source: "original" }, { conditionalPut: true, conditionalDelete: true, streamingRead: true, streamingWrite: true });
  const get = setup.transport.getObjectStream!;
  let destroyed = false;
  setup.transport.getObjectStream = async (input, options) => {
    const output = await get(input, options);
    return { ...output, Body: Object.assign(output.Body, { destroy() { destroyed = true; } }) };
  };
  setup.transport.putObjectStream = async () => ({});
  await assert.rejects(setup.fs.rename("/source", "/target"), partial("copy", "EIO", [], []));
  assert.equal(destroyed, true);
  assert.deepEqual(await setup.state(), { source: "original" });
});

for (const streaming of [false, true]) {
  test(`${streaming ? "streaming" : "buffered"} fallback rejects missing source ETag before destination PUT`, settings, async () => {
    const setup = await fixture({ source: "original" }, { conditionalPut: true, conditionalDelete: true,
      streamingRead: streaming, streamingWrite: streaming });
    if (streaming) {
      const get = setup.transport.getObjectStream!;
      setup.transport.getObjectStream = async (input, options) => {
        const { ETag: _etag, ...output } = await get(input, options);
        return output;
      };
    } else {
      const get = setup.transport.getObject;
      setup.transport.getObject = async (input, options) => {
        const { ETag: _etag, ...output } = await get(input, options);
        return output;
      };
    }
    await assert.rejects(setup.fs.rename("/source", "/target"), partial("copy", "ENOTSUP", [], []));
    assert.equal(setup.client.requests.slice(setup.seededRequests).some(request =>
      ["putObject", "copyObject", "deleteObject"].includes(request.operation)), false);
    assert.deepEqual(await setup.state(), { source: "original" });
  });
}
