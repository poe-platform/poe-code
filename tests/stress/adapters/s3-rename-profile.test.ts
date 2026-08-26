import assert from "node:assert/strict";
import { test } from "node:test";
import { MockS3Client, S3FileSystem, S3RenameError, createS3Transport } from "../../../src/fs/s3/index.js";
import { binary, errno } from "../../fs/conformance/fixtures.js";

const bucket = "rename-profile";

for (const profile of ["conditional-copy", "buffered-put", "streamed-put"] as const) {
  for (const existing of [false, true]) {
    test(`s3: default ${profile} rename ${existing ? "replaces" : "creates"} with exact guards and bytes`, async () => {
      const mock = new MockS3Client({ buckets: [bucket] });
      const transport = createS3Transport(mock, {
        conditionalCopy: profile === "conditional-copy", conditionalPut: true, conditionalDelete: true,
        streamingRead: profile === "streamed-put", streamingWrite: profile === "streamed-put",
      });
      const fs = new S3FileSystem({ transport, bucket });
      await fs.writeFile("/source", binary);
      if (existing) await fs.writeFile("/dest", new Uint8Array([9, 0]));
      await fs.writeFile("/sentinel", new Uint8Array([255, 7]));
      const source = await mock.headObject({ Bucket: bucket, Key: "source" });
      const target = existing ? await mock.headObject({ Bucket: bucket, Key: "dest" }) : undefined;
      const before = mock.requests.length;
      await fs.rename("/source", "/dest");
      const mutations = mock.requests.slice(before).filter(request => ["copyObject", "putObject", "deleteObject"].includes(request.operation));
      assert.deepEqual(mutations.map(request => request.operation), [profile === "conditional-copy" ? "copyObject" : "putObject", "deleteObject"]);
      const publication = mutations[0]!.input;
      assert.equal("IfMatch" in publication ? publication.IfMatch : undefined, target?.ETag);
      assert.equal("IfNoneMatch" in publication ? publication.IfNoneMatch : undefined, existing ? undefined : "*");
      if (profile === "conditional-copy") assert.equal("CopySourceIfMatch" in publication && publication.CopySourceIfMatch, source.ETag);
      const deletion = mutations[1]!.input;
      assert.equal("Key" in deletion && deletion.Key, "source");
      assert.equal("IfMatch" in deletion && deletion.IfMatch, source.ETag);
      assert.deepEqual(await fs.readFile("/dest"), binary);
      assert.deepEqual(await fs.readFile("/sentinel"), new Uint8Array([255, 7]));
      await assert.rejects(fs.stat("/source"), errno("ENOENT"));
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["dest", "sentinel"]);
      assert.equal(fs.capabilities.atomicRename, false);
    });
  }
}

for (const capabilities of [{}, { conditionalDelete: true }, { conditionalCopy: false, conditionalPut: false, conditionalDelete: true }, { conditionalPut: true }]) {
  test(`s3: default rename missing guards ${JSON.stringify(capabilities)} has no host effects`, async () => {
    const mock = new MockS3Client({ buckets: [bucket] });
    await mock.putObject({ Bucket: bucket, Key: "source", Body: binary });
    await mock.putObject({ Bucket: bucket, Key: "dest", Body: new Uint8Array([9, 0]) });
    const fs = new S3FileSystem({ bucket, transport: createS3Transport(mock, capabilities) });
    const before = mock.requests.length;
    await assert.rejects(fs.rename("/source", "/dest"), errno("ENOTSUP"));
    assert.equal(mock.requests.length, before);
    assert.deepEqual(await fs.readFile("/source"), binary);
    assert.deepEqual(await fs.readFile("/dest"), new Uint8Array([9, 0]));
    assert.equal(fs.capabilities.atomicRename, false);
  });
}

for (const phase of ["copy", "delete"] as const) {
  test(`s3: default rename ${phase} race preserves winning bytes and exact acknowledged effects`, async () => {
    const winner = new Uint8Array([255, 0, 71]);
    let armed = false;
    const mock = new MockS3Client({ buckets: [bucket], authorize: async request => {
      if (armed && request.operation === (phase === "copy" ? "copyObject" : "deleteObject")) {
        armed = false;
        await mock.putObject({ Bucket: bucket, Key: phase === "copy" ? "dest" : "source", Body: winner });
      }
    } });
    const fs = new S3FileSystem({ transport: mock, bucket });
    await fs.writeFile("/source", binary);
    armed = true;
    await assert.rejects(fs.rename("/source", "/dest"), error => {
      assert.ok(error instanceof S3RenameError);
      assert.equal(error.code, "EAGAIN");
      assert.equal(error.phase, phase);
      assert.equal(error.path, "/source");
      assert.equal(error.dest, "/dest");
      assert.deepEqual(error.copiedKeys, phase === "copy" ? [] : ["dest"]);
      assert.deepEqual(error.deletedKeys, []);
      return true;
    });
    assert.equal(armed, false);
    assert.deepEqual(await fs.readFile("/source"), phase === "copy" ? binary : winner);
    assert.deepEqual(await fs.readFile("/dest"), phase === "copy" ? winner : binary);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["dest", "source"]);
  });
}
