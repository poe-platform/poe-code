import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import type { FileStat, FileSystem, FsOptions } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { createOverlayFileSystem } from "../../../../src/fs/overlay/index.js";
import { MockS3Client, S3FileSystem, createS3Transport, S3ServiceError } from "../../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import type { WebDavFetch } from "../../../../src/fs/webdav/index.js";
import { davChild, davChildren, parseXml, scalar } from "../../../../src/fs/webdav/xml.js";
import { MockDav } from "../../webdav/mock.js";
import { FixtureAuthority, maybeStat, proofCopy, proofMove, view } from "./proposal.js";
import type { ComparableFileSystem } from "./proposal.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = async (filesystem: FileSystem, path: string): Promise<string> => new TextDecoder().decode(await filesystem.readFile(path));
const noIdentity = (stat: FileStat): FileStat => {
  const { identityScope: _scope, dev: _device, ino: _inode, ...other } = stat;
  return other;
};
const opaque = (filesystem: FileSystem): ComparableFileSystem => view(filesystem, {
  stat: async (path, options) => noIdentity(await filesystem.stat(path, options)),
  lstat: async (path, options) => noIdentity(await filesystem.lstat(path, options)),
});
const record = (name: string, data: unknown): void => console.log(`AUTHORITY_OBSERVATION ${Buffer.from(JSON.stringify({ case: name, data })).toString("base64")}`);

async function remote(kind: "s3" | "webdav") {
  const authority = new FixtureAuthority();
  const storageAuthority = {};
  let first: FileSystem;
  let second: FileSystem;
  let operations: () => string[];
  if (kind === "s3") {
    const store = new MockS3Client({ buckets: ["bucket"] });
    first = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket" });
    second = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket" });
    operations = () => store.requests.map(request => request.operation);
  } else {
    const store = new MockDav();
    first = new WebDavFileSystem({ baseUrl: "https://one.example/dav/", fetch: (url, init) => store.fetch(url, init), overwritePolicy: "etag" });
    second = new WebDavFileSystem({ baseUrl: "https://alias.example/dav/", fetch: (url, init) => store.fetch(url, init), overwritePolicy: "etag" });
    operations = () => store.requests.map(request => request.init.method!);
  }
  await first.writeFile("/source", bytes("source sentinel"));
  await first.writeFile("/target", bytes("target sentinel"));
  const resolve = async (path: string, options: FsOptions) => {
    if (!await maybeStat(first, path, options)) return undefined;
    return { authority: storageAuthority, entry: path };
  };
  return {
    rawFirst: first, rawSecond: second,
    first: authority.enroll(first, resolve), second: authority.enroll(second, resolve), operations,
  };
}

for (const kind of ["s3", "webdav"] as const) {
  test(`${kind}: negotiated authority permits same-view and separate-client ordinary overwrites`, async () => {
    const fixture = await remote(kind);
    const receipts = [];
    receipts.push(await proofCopy(fixture.first, "/source", fixture.first, "/target"));
    await fixture.rawFirst.writeFile("/target", bytes("reset"));
    receipts.push(await proofCopy(fixture.first, "/source", fixture.second, "/target"));
    assert.equal(await text(fixture.rawSecond, "/target"), "source sentinel");
    assert.equal(await text(fixture.rawFirst, "/source"), "source sentinel");
    assert.equal((await fixture.rawFirst.stat("/source")).identityScope, undefined);
    record(`${kind}-positive`, { receipts, operations: fixture.operations() });
  });

  test(`${kind}: shared storage through distinct clients/endpoint aliases rejects before body IO`, async () => {
    const fixture = await remote(kind);
    const start = fixture.operations().length;
    await assert.rejects(proofCopy(fixture.first, "/source", fixture.second, "/source"), { code: "EINVAL" });
    const observed = fixture.operations().slice(start);
    assert.ok(observed.every(operation => ["headObject", "listObjectsV2", "PROPFIND"].includes(operation)));
    assert.equal(await text(fixture.rawFirst, "/source"), "source sentinel");
    record(`${kind}-alias`, observed);
  });

  test(`${kind}: unregistered peer stays unknown despite distinct client and equal metadata`, async () => {
    const fixture = await remote(kind);
    await fixture.rawFirst.writeFile("/target", bytes("source sentinel"));
    const start = fixture.operations().length;
    await assert.rejects(proofCopy(fixture.first, "/source", fixture.rawSecond, "/target"), { code: "ENOTSUP" });
    assert.ok(fixture.operations().slice(start).every(operation => ["headObject", "listObjectsV2", "PROPFIND"].includes(operation)));
    assert.equal(await text(fixture.rawSecond, "/target"), "source sentinel");
  });

  test(`${kind}: missing unknown target uses real exclusive creation; existing exclusive target rejects`, async () => {
    const fixture = await remote(kind);
    const receipt = await proofCopy(fixture.rawFirst, "/source", fixture.rawSecond, "/new");
    assert.equal(receipt.basis, "exclusive-create");
    assert.equal(await text(fixture.rawSecond, "/new"), "source sentinel");
    const start = fixture.operations().length;
    await assert.rejects(proofCopy(fixture.first, "/source", fixture.second, "/target", { exclusive: true }), { code: "EEXIST" });
    assert.ok(fixture.operations().slice(start).every(operation => ["headObject", "listObjectsV2", "PROPFIND"].includes(operation)));
    assert.equal(await text(fixture.rawSecond, "/target"), "target sentinel");
  });
}

test("S3 native same-path copy is successful no-op, not the proposed guardedCopy rejection", async () => {
  const fixture = await remote("s3");
  const start = fixture.operations().length;
  await fixture.rawFirst.copyFile("/source", "/source");
  assert.ok(!fixture.operations().slice(start).includes("copyObject"));
  assert.equal(await text(fixture.rawFirst, "/source"), "source sentinel");
});

test("S3 actual conditional CopyObject preserves a raced exclusive destination", async () => {
  let insert = false;
  const store = new MockS3Client({ buckets: ["bucket"], authorize: async request => {
    if (insert && request.operation === "copyObject") {
      insert = false;
      await store.putObject({ Bucket: "bucket", Key: "target", Body: bytes("racer") });
    }
  } });
  const filesystem = new S3FileSystem({ transport: store, bucket: "bucket" });
  await filesystem.writeFile("/source", bytes("source"));
  insert = true;
  await assert.rejects(filesystem.copyFile("/source", "/target", { exclusive: true }), { code: "EEXIST" });
  assert.equal(await text(filesystem, "/target"), "racer");
  assert.equal(await text(filesystem, "/source"), "source");
  const request = store.requests.find(request => request.operation === "copyObject");
  assert.ok(request && "IfNoneMatch" in request.input && request.input.IfNoneMatch === "*");
  record("s3-native-exclusive", request);
});

test("WebDAV actual native COPY uses Overwrite F against a raced missing target", async () => {
  const store = new MockDav();
  let insert = false;
  const fetch: WebDavFetch = async (url, init) => {
    if (insert && init.method === "COPY") {
      insert = false;
      store.files.set("/target", bytes("racer"));
    }
    return store.fetch(url, init);
  };
  const filesystem = new WebDavFileSystem({ baseUrl: "https://one.example/dav/", fetch });
  await filesystem.writeFile("/source", bytes("source"));
  insert = true;
  await assert.rejects(filesystem.copyFile("/source", "/target"));
  assert.equal(await text(filesystem, "/target"), "racer");
  assert.equal(await text(filesystem, "/source"), "source");
  const request = store.requests.find(request => request.init.method === "COPY");
  assert.equal(request?.headers.get("Overwrite"), "F");
  record("dav-native-exclusive", { overwrite: request?.headers.get("Overwrite") });
});

test("WebDAV native COPY plus ETags is not an alias-safe guard in an alias-routing mock", async () => {
  const store = new MockDav();
  const canonical = (url: string): string => url.replace("/dav/alias", "/dav/source");
  const fetch: WebDavFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    if (headers.has("Destination")) headers.set("Destination", canonical(headers.get("Destination")!));
    if (headers.has("If")) headers.set("If", canonical(headers.get("If")!));
    const response = await store.fetch(canonical(url), { ...init, headers });
    if (init.method === "PROPFIND" && url.includes("/dav/alias")) {
      return new Response((await response.text()).replaceAll("/dav/source", "/dav/alias"), { status: response.status, headers: response.headers });
    }
    return response;
  };
  const filesystem = new WebDavFileSystem({ baseUrl: "https://one.example/dav/", fetch, overwritePolicy: "etag" });
  await filesystem.writeFile("/source", bytes("sentinel"));
  await filesystem.copyFile("/source", "/alias");
  assert.equal(store.files.has("/source"), false);
  record("dav-alias-native-counterexample", { sourceLost: true, mockIsNotAliasSafeServer: true });
  store.files.set("/source", bytes("sentinel"));
  const authority = new FixtureAuthority();
  const storage = {};
  const enrolled = authority.enroll(filesystem, async path => ({ authority: storage, entry: path === "/alias" ? "/source" : path }));
  const start = store.requests.length;
  await assert.rejects(proofCopy(enrolled, "/source", enrolled, "/alias"), { code: "EINVAL" });
  assert.ok(store.requests.slice(start).every(request => request.init.method === "PROPFIND"));
  assert.equal(await text(filesystem, "/source"), "sentinel");
});

async function memoryPair() {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/source", bytes("source"));
  await memory.writeFile("/target", bytes("target"));
  const authority = new FixtureAuthority();
  const storage = {};
  const first = opaque(memory);
  const second = opaque(memory);
  const resolve = async (path: string, options: FsOptions) => {
    const stat = await maybeStat(memory, path, options);
    return stat ? { authority: storage, entry: `${stat.dev}:${stat.ino}` } : undefined;
  };
  return { memory, authority, storage, resolve, first: authority.enroll(first, resolve), second: authority.enroll(second, resolve) };
}

test("different authority objects remain unknown until the owner certifies genuinely disjoint stores", async () => {
  const authority = new FixtureAuthority();
  const leftStore = createMemoryFileSystem();
  const rightStore = createMemoryFileSystem();
  await leftStore.writeFile("/file", bytes("left"));
  await rightStore.writeFile("/file", bytes("right"));
  const leftAuthority = {};
  const rightAuthority = {};
  const left = authority.enroll(opaque(leftStore), async () => ({ authority: leftAuthority, entry: "/file" }));
  const right = authority.enroll(opaque(rightStore), async () => ({ authority: rightAuthority, entry: "/file" }));
  await assert.rejects(proofCopy(left, "/file", right, "/file"), { code: "ENOTSUP" });
  authority.certifyDisjoint(leftAuthority, rightAuthority);
  await proofCopy(left, "/file", right, "/file");
  assert.equal(await text(rightStore, "/file"), "left");
});

test("read-only forwarding preserves backing aliases without granting destination writes", async () => {
  const fixture = await memoryPair();
  await fixture.memory.link!("/source", "/alias");
  const readonly = fixture.authority.enroll(createReadOnlyFileSystem(opaque(fixture.memory)), fixture.resolve);
  await assert.rejects(proofCopy(readonly, "/source", fixture.second, "/alias"), { code: "EINVAL" });
  await proofCopy(readonly, "/source", fixture.second, "/target");
  await assert.rejects(proofCopy(fixture.first, "/target", readonly, "/source"), { code: "EROFS" });
  assert.equal(await text(fixture.memory, "/source"), "source");
});

test("overlay comparison re-observes selected backing after copy-up, not a wrapper-local token", async () => {
  const lower = createMemoryFileSystem();
  const upper = createMemoryFileSystem();
  await lower.writeFile("/file", bytes("lower"));
  const overlay = createOverlayFileSystem({ lower, upper });
  const authority = new FixtureAuthority();
  const resolve = (filesystem: FileSystem) => async (path: string, options: FsOptions) => {
    const stat = await filesystem.stat(path, options);
    assert.ok(typeof stat.identityScope === "object" || typeof stat.identityScope === "symbol");
    return { authority: stat.identityScope!, entry: `${stat.dev}:${stat.ino}` };
  };
  const lowerView = authority.enroll(opaque(lower), resolve(lower));
  const overlayView = authority.enroll(opaque(overlay), resolve(overlay));
  assert.equal(await lowerView.compareEntry!("/file", overlayView, "/file"), "same");
  await overlay.writeFile("/file", bytes("upper"));
  authority.certifyDisjoint((await lower.stat("/file")).identityScope!, (await upper.stat("/file")).identityScope!);
  assert.equal(await lowerView.compareEntry!("/file", overlayView, "/file"), "distinct");
  assert.equal(await text(lower, "/file"), "lower");
});

test("contradictory authoritative answers fail before source acquisition", async () => {
  const fixture = await memoryPair();
  let reads = 0;
  const source = view(opaque(fixture.memory), { compareEntry: async () => "distinct", readFile: async () => { reads++; return bytes("bad"); } });
  const target = view(opaque(fixture.memory), { compareEntry: async () => "same" });
  await assert.rejects(proofCopy(source, "/source", target, "/target"), { code: "EIO" });
  assert.equal(reads, 0);
  assert.equal(await text(fixture.memory, "/target"), "target");
});

test("failed metadata and pre-cancel do not become missing targets", async () => {
  const fixture = await memoryPair();
  const controller = new AbortController();
  const reason = new FsError("ENOENT");
  const target = view(fixture.second, { stat: async () => { controller.abort(reason); throw reason; } });
  await assert.rejects(proofCopy(fixture.first, "/source", target, "/target", { signal: controller.signal }), error => error === reason);
  await assert.rejects(proofCopy(fixture.first, "/source", fixture.second, "/target", { signal: controller.signal }), error => error === reason);
  assert.equal(await text(fixture.memory, "/target"), "target");
});

test("a raced generic exclusive target is preserved", async () => {
  const fixture = await memoryPair();
  const target = view(opaque(fixture.memory), { writeFile: async (path, data, options) => {
    await fixture.memory.writeFile(path, bytes("racer"));
    await fixture.memory.writeFile(path, data, options);
  } });
  await assert.rejects(proofCopy(fixture.first, "/source", target, "/new"), { code: "EEXIST" });
  assert.equal(await text(fixture.memory, "/new"), "racer");
});

for (const failure of ["source", "target", "cancel"] as const) {
  test(`move: ${failure} failure never removes source (partial destination is disclosed)`, async () => {
    const fixture = await memoryPair();
    const controller = new AbortController();
    let removes = 0;
    const source = view(opaque(fixture.memory), {
      compareEntry: async () => "distinct",
      readFile: async (path, options) => {
        if (failure === "source") throw new FsError("EIO");
        return fixture.memory.readFile(path, options);
      },
      rm: async () => { removes++; },
    });
    const target = view(opaque(fixture.memory), { writeFile: async (path, _data, options) => {
      await fixture.memory.writeFile(path, bytes("partial"), options);
      if (failure === "cancel") controller.abort(new Error("cancel after publication"));
      else throw new FsError("EIO");
    } });
    await assert.rejects(proofMove(source, "/source", target, "/target", { signal: controller.signal }));
    assert.equal(removes, 0);
    assert.equal(await text(fixture.memory, "/source"), "source");
    assert.equal(await text(fixture.memory, "/target"), failure === "source" ? "target" : "partial");
  });
}

test("move: alias and unknown are not successful no-op receipts; distinct copy completes before remove", async () => {
  const fixture = await memoryPair();
  await fixture.memory.link!("/source", "/alias");
  await assert.rejects(proofMove(fixture.first, "/source", fixture.second, "/alias"), { code: "EINVAL" });
  await assert.rejects(proofMove(opaque(fixture.memory), "/source", opaque(fixture.memory), "/target"), { code: "ENOTSUP" });
  assert.equal(await text(fixture.memory, "/source"), "source");
  const events: string[] = [];
  const source = view(opaque(fixture.memory), {
    compareEntry: async () => "distinct",
    rm: async (path, options) => {
      events.push("remove");
      assert.equal(await text(fixture.memory, "/target"), "source");
      await fixture.memory.rm(path, options);
    },
  });
  const target = view(opaque(fixture.memory), { writeFile: async (path, data, options) => {
    events.push("copy-start");
    await fixture.memory.writeFile(path, data, options);
    events.push("copy-success");
  } });
  await proofMove(source, "/source", target, "/target");
  assert.deepEqual(events, ["copy-start", "copy-success", "remove"]);
  record("move-ordering", events);
});

test("observation-time comparison is not a lease: post-comparison alias replacement can destroy source", async () => {
  const fixture = await memoryPair();
  const source = view(fixture.first, { readFile: async (path, options) => {
    await fixture.memory.rm("/target");
    await fixture.memory.link!("/source", "/target");
    return fixture.memory.readFile(path, options);
  } });
  const target = view(opaque(fixture.memory), { writeFile: async (path, _data, options) => {
    await fixture.memory.writeFile(path, bytes("partial"), options);
    throw new FsError("EIO");
  } });
  const observingSource = view(source, { compareEntry: async (_path, _peer, _peerPath, options) => fixture.first.compareEntry!("/source", fixture.second, "/target", options) });
  await assert.rejects(proofCopy(observingSource, "/source", target, "/target"), { code: "EIO" });
  assert.equal(await text(fixture.memory, "/source"), "partial");
  record("pathname-race-limit", { sourceLostAfterExternalAliasReplacement: true });
});

test("generic move rm has no incarnation condition: source ABA after copy deletes replacement", async () => {
  const fixture = await memoryPair();
  let replacementInode: number | undefined;
  const source = view(opaque(fixture.memory), { compareEntry: async () => "distinct" });
  const originalInode = (await fixture.memory.stat("/source")).ino;
  const target = view(opaque(fixture.memory), { writeFile: async (path, data, options) => {
    await fixture.memory.writeFile(path, data, options);
    await fixture.memory.rm("/source");
    await fixture.memory.writeFile("/source", bytes("replacement"));
    replacementInode = (await fixture.memory.stat("/source")).ino;
  } });
  await proofMove(source, "/source", target, "/target");
  assert.notEqual(originalInode, replacementInode);
  await assert.rejects(fixture.memory.stat("/source"), { code: "ENOENT" });
  assert.equal(await text(fixture.memory, "/target"), "source");
  record("move-aba-limit", { replacementDeleted: true, originalInode, replacementInode });
});

test("S3 native copy source failure is not a successful move receipt", async () => {
  let failCopy = false;
  const store = new MockS3Client({ buckets: ["bucket"], authorize: request => {
    if (failCopy && request.operation === "copyObject") throw new S3ServiceError("AccessDenied", 403);
  } });
  const filesystem = new S3FileSystem({ transport: store, bucket: "bucket" });
  await filesystem.writeFile("/source", bytes("source"));
  await filesystem.writeFile("/target", bytes("target"));
  failCopy = true;
  await assert.rejects(filesystem.copyFile("/source", "/target"), { code: "EACCES" });
  assert.ok(!store.requests.some(request => request.operation === "deleteObject"));
  assert.equal(await text(filesystem, "/source"), "source");
  assert.equal(await text(filesystem, "/target"), "target");
});

test("S3 negotiated overlapping prefix views compare effective keys, not local paths", async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  const left = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket", prefix: "root" });
  const right = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket", prefix: "root/nested" });
  await left.mkdir("/nested");
  await left.writeFile("/nested/file", bytes("source"));
  await right.writeFile("/target", bytes("target"));
  const authority = new FixtureAuthority();
  const storage = {};
  const source = authority.enroll(left, async path => ({ authority: storage, entry: `bucket/root${path}` }));
  const target = authority.enroll(right, async path => ({ authority: storage, entry: `bucket/root/nested${path}` }));
  await assert.rejects(proofCopy(source, "/nested/file", target, "/file"), { code: "EINVAL" });
  await proofCopy(source, "/nested/file", target, "/target");
  assert.equal(await text(right, "/target"), "source");
  assert.equal(await text(left, "/nested/file"), "source");
});

test("fresh comparison observes pre-call rebinding instead of reusing old metadata", async () => {
  const fixture = await memoryPair();
  assert.equal(await fixture.first.compareEntry!("/source", fixture.second, "/target"), "distinct");
  await fixture.memory.rm("/target");
  await fixture.memory.link!("/source", "/target");
  await assert.rejects(proofCopy(fixture.first, "/source", fixture.second, "/target"), { code: "EINVAL" });
  assert.equal(await text(fixture.memory, "/source"), "source");
});

test("cancellation during authority resolution is forwarded and precedes content reads", async () => {
  const fixture = await memoryPair();
  const controller = new AbortController();
  const reason = new Error("metadata cancelled");
  let reads = 0;
  const source = view(opaque(fixture.memory), {
    compareEntry: async (_path, _peer, _peerPath, options) => {
      assert.equal(options?.signal, controller.signal);
      controller.abort(reason);
      return "distinct";
    },
    readFile: async () => { reads++; return bytes("forbidden"); },
  });
  await assert.rejects(proofCopy(source, "/source", opaque(fixture.memory), "/target", { signal: controller.signal }), error => error === reason);
  assert.equal(reads, 0);
  assert.equal(await text(fixture.memory, "/target"), "target");
});

test("WebDAV resource-id protocol fixture supports pairwise proof without content or numeric inode IDs", async () => {
  const store = new MockDav();
  const identifiers = new Map([
    ["/source", "urn:uuid:59b88385-6b77-4fae-9ab6-72ee0c2d9483"],
    ["/target", "urn:uuid:4a4a3d01-9604-4f47-87e7-ac93d1cc72e8"],
  ]);
  let duplicateProperty = false;
  const fetch: WebDavFetch = async (url, init) => {
    const response = await store.fetch(url, init);
    if (init.method !== "PROPFIND" || !String(init.body).includes("resource-id") || response.status !== 207) return response;
    const identifier = identifiers.get(new URL(url).pathname.slice(4));
    const suppliedXml = await response.text();
    assert.equal([...suppliedXml.matchAll(/<z:resource-id>.*?<\/z:resource-id>/gs)].length, 1);
    const xml = suppliedXml.replace(/<z:resource-id>.*?<\/z:resource-id>/gs, "");
    const extra = identifier ? `<z:resource-id><z:href>${identifier}</z:href></z:resource-id>` : "";
    return new Response(xml.replace("</z:prop>", `${extra}${duplicateProperty ? extra : ""}</z:prop>`), { status: 207, headers: response.headers });
  };
  const first = new WebDavFileSystem({ baseUrl: "https://one.example/dav/", fetch, overwritePolicy: "etag" });
  const second = new WebDavFileSystem({ baseUrl: "https://alias.example/dav/", fetch, overwritePolicy: "etag" });
  await first.writeFile("/source", bytes("identical"));
  await first.writeFile("/target", bytes("identical"));
  assert.equal(store.etag("/source"), store.etag("/target"));
  const authority = new FixtureAuthority();
  const protocolAuthority = {};
  const resolve = (base: string) => async (path: string, options: FsOptions) => {
    options.signal?.throwIfAborted();
    const response = await fetch(`${base}${path}`, {
      method: "PROPFIND", headers: { Depth: "0", "Content-Type": "application/xml", "Cache-Control": "no-cache" },
      body: '<d:propfind xmlns:d="DAV:"><d:prop><d:resource-id/></d:prop></d:propfind>',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.status !== 207) return undefined;
    const document = parseXml(await response.text());
    options.signal?.throwIfAborted();
    const entries = davChildren(document, "response");
    if (entries.length !== 1) return undefined;
    const entry = entries[0]!;
    const href = davChild(entry, "href");
    if (!href || scalar(href) !== `/dav${path}`) return undefined;
    const identifiers: string[] = [];
    for (const properties of davChildren(entry, "propstat")) {
      const status = davChild(properties, "status");
      const prop = davChild(properties, "prop");
      if (!status || !prop || !/^HTTP\/1\.1 200 /.test(scalar(status))) continue;
      for (const identifier of davChildren(prop, "resource-id")) {
        const values = davChildren(identifier, "href");
        if (values.length === 1) identifiers.push(scalar(values[0]!));
      }
    }
    if (identifiers.length !== 1 || !/^urn:uuid:[0-9a-f-]{36}$/.test(identifiers[0]!)) return undefined;
    return { authority: protocolAuthority, entry: identifiers[0]! };
  };
  const source = authority.enroll(first, resolve("https://one.example/dav"));
  const target = authority.enroll(second, resolve("https://alias.example/dav"));
  assert.equal((await resolve("https://one.example/dav")("/source", {}))?.entry, identifiers.get("/source"));
  assert.equal((await resolve("https://alias.example/dav")("/target", {}))?.entry, identifiers.get("/target"));
  await proofCopy(source, "/source", source, "/target");
  await proofCopy(source, "/source", target, "/target");
  await assert.rejects(proofCopy(source, "/source", target, "/source"), { code: "EINVAL" });
  duplicateProperty = true;
  const duplicateStart = store.requests.length;
  assert.equal(await resolve("https://alias.example/dav")("/target", {}), undefined);
  await assert.rejects(proofCopy(source, "/source", target, "/target"), { code: "ENOTSUP" });
  assert.ok(store.requests.slice(duplicateStart).every(request => request.init.method === "PROPFIND"));
  duplicateProperty = false;
  identifiers.delete("/target");
  assert.equal(await resolve("https://alias.example/dav")("/target", {}), undefined);
  const start = store.requests.length;
  await assert.rejects(proofCopy(source, "/source", target, "/target"), { code: "ENOTSUP" });
  assert.ok(store.requests.slice(start).every(request => request.init.method === "PROPFIND"));
  assert.equal(await text(first, "/source"), "identical");
  assert.equal(await text(second, "/target"), "identical");
  record("dav-resource-id", { sameViewCopy: true, crossViewCopy: true, endpointAliasRejected: true, missingPropertyIsUnknown: true, duplicatePropertyIsUnknown: true });
});
