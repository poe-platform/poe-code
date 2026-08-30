import assert from "node:assert/strict";
import { FsError } from "../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { MockS3Client, S3FileSystem, S3ServiceError } from "../../../../src/fs/s3/index.js";
import type { MockS3Operation } from "../../../../src/fs/s3/index.js";

const observations: unknown[] = [];
const binary = new Uint8Array([0, 255, 17, 128]);
const replacement = new Uint8Array([42, 0]);
let denied: MockS3Operation | undefined;
let abortDuring: MockS3Operation | undefined;
let activeController: AbortController | undefined;
const client = new MockS3Client({
  buckets: ["bucket"], now: () => new Date("2026-08-26T00:00:00Z"),
  authorize(request) {
    if (request.operation === denied) throw new S3ServiceError("AccessDenied", 403);
    if (request.operation === abortDuring) activeController?.abort(new FsError("ENOENT"));
  },
});
const options = { bucket: "bucket", prefix: "profile", transport: client };
const fs = new S3FileSystem(options);
const fresh = new S3FileSystem(options);

async function observe(name: string, action: () => Promise<unknown>, expectedCode?: string) {
  const start = client.requests.length;
  let value: unknown;
  let failure: unknown;
  try { value = await action(); } catch (error) { failure = error; }
  const requests = client.requests.slice(start);
  observations.push({
    name, resolved: failure === undefined, value: value ?? null,
    error: failure instanceof FsError
      ? { typedFsError: true, code: failure.code, path: failure.path, syscall: failure.syscall }
      : failure === undefined ? null : String(failure),
    requestCount: requests.length,
    requests: requests.map(({ operation, input }) => ({ operation, input })),
  });
  if (expectedCode === undefined) assert.equal(failure, undefined, name);
  else {
    assert.ok(failure instanceof FsError, name);
    assert.equal(failure.code, expectedCode, name);
  }
  return requests;
}

async function inspect(path: string, expected: Uint8Array, mode: number) {
  await observe(`fresh stat/lstat/read ${path}`, async () => {
    const stat = await fresh.stat(path);
    assert.equal(stat.mode & 0o7777, mode);
    assert.equal(stat.type, "file");
    assert.equal(stat.size, expected.length);
    assert.deepEqual(await fresh.lstat(path), stat);
    const bytes = await fresh.readFile(path, { maxBytes: 64 });
    assert.deepEqual(bytes, expected);
    const raw = await client.getObject({ Bucket: "bucket", Key: `profile${path}` });
    assert.deepEqual(raw.Body, expected);
    assert.equal(raw.Metadata?.["virtual-bash-mode"], String(mode));
    return { stat, bytes, rawMetadata: raw.Metadata };
  });
}

assert.equal(fs.capabilities.permissions, false);
for (const mode of [0o0000, 0o0600, 0o0755]) {
  for (const flag of ["w", "wx", "a", "ax"] as const) {
    const path = `/mode-${mode.toString(8)}-${flag}`;
    const created = await observe(`OBSERVED creation mode=${mode.toString(8)} flag=${flag}`, () => fs.writeFile(path, binary, { mode, flag }));
    assert.equal(created.length, 5);
    const put = created.filter(request => request.operation === "putObject");
    assert.equal(put.length, 1);
    assert.ok("IfNoneMatch" in put[0]!.input || flag === "w");
    if (flag !== "w") assert.equal((put[0]!.input as { IfNoneMatch?: string }).IfNoneMatch, "*");
    await inspect(path, binary, mode);
    for (const [name, accessMode] of [["F_OK", 0], ["R_OK", 4], ["W_OK", 2], ["X_OK", 1]] as const) {
      const requests = await observe(`OBSERVED ${name} ${path}`, () => fresh.access(path, accessMode), accessMode === 1 ? "EACCES" : undefined);
      assert.equal(requests.length, 4);
      assert.ok(requests.every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
    }
    const exclusive = flag === "wx" || flag === "ax";
    const rewritten = await observe(`existing mode ignored flag=${flag} ${path}`, () => fs.writeFile(path, replacement, { flag, mode: 0o777 }), exclusive ? "EEXIST" : undefined);
    if (exclusive) assert.equal(rewritten.filter(request => request.operation === "putObject").length, 0);
    await inspect(path, exclusive ? binary : flag === "w" ? replacement : new Uint8Array([...binary, ...replacement]), mode);
  }
}

for (const mode of [0o0000, 0o0700]) {
  const path = `/dir-${mode.toString(8)}`;
  const created = await observe(`OBSERVED directory creation mode=${mode.toString(8)}`, () => fs.mkdir(path, { mode }));
  assert.equal(created.length, 5);
  await observe(`OBSERVED directory stat/readdir mode=${mode.toString(8)}`, async () => {
    const stat = await fresh.stat(path);
    assert.equal(stat.mode & 0o7777, mode);
    assert.equal(stat.type, "directory");
    assert.deepEqual(await fresh.readdir(path), []);
    await fresh.writeFile(`${path}/child`, binary);
    assert.deepEqual(await fresh.readdir(path), [{ name: "child", type: "file" }]);
    assert.deepEqual(await fresh.readFile(`${path}/child`, { maxBytes: 64 }), binary);
    return { stat, entries: await fresh.readdir(path) };
  });
  for (const accessMode of [0, 1, 2, 4, 7]) {
    const requests = await observe(`OBSERVED directory access=${accessMode} mode=${mode.toString(8)}`, () => fresh.access(path, accessMode));
    assert.equal(requests.length, 3);
  }
}

const target = "/mode-0-wx";
for (const path of [target, "/dir-0", "/missing"]) {
  const requests = await observe(`chmod unsupported ${path}`, () => fs.chmod(path, 0o600), "ENOTSUP");
  assert.equal(requests.length, 0);
}
await inspect(target, binary, 0);
for (const accessMode of [0, 1, 2, 4]) await observe(`missing access=${accessMode}`, () => fs.access("/missing", accessMode), "ENOENT");
for (const mode of [-1, 0o10000, NaN]) {
  const requests = await observe(`invalid mode=${String(mode)}`, () => fs.writeFile("/invalid", binary, { mode }), "EINVAL");
  assert.equal(requests.length, 0);
}
await observe("appendFile mode0000 creation", () => fs.appendFile("/append", binary, { mode: 0 }));
await inspect("/append", binary, 0);
assert.ok(fs.writeStream);
await observe("writeStream mode0000 exclusive creation", () => fs.writeStream!("/stream", (async function* () { yield binary; })(), { mode: 0, flag: "wx" }));
await inspect("/stream", binary, 0);

const readOnly = new S3FileSystem({ ...options, readOnly: true });
await observe("readonly R_OK", () => readOnly.access(target, 4));
await observe("readonly W_OK", () => readOnly.access(target, 2), "EROFS");
const readonlyWrite = await observe("readonly mode write", () => readOnly.writeFile(target, replacement, { mode: 0o600 }), "EROFS");
assert.equal(readonlyWrite.length, 0);

denied = "putObject";
await observe("W_OK succeeds despite denied PUT: not authorization proof", () => fs.access(target, 2));
await observe("provider PUT denial", () => fs.writeFile(target, replacement), "EACCES");
denied = "getObject";
await observe("R_OK succeeds despite denied GET: not authorization proof", () => fs.access(target, 4));
await observe("provider GET denial", () => fs.readFile(target, { maxBytes: 64 }), "EACCES");
denied = "headObject";
await observe("provider HEAD denial propagates through access", () => fs.access(target, 4), "EACCES");
denied = undefined;
await inspect(target, binary, 0);

for (const reason of [new Error("cancel"), new FsError("ENOENT"), new FsError("EACCES")]) {
  const signal = AbortSignal.abort(reason);
  for (const [name, action] of [
    ["read", () => fs.readFile(target, { signal, maxBytes: 64 })],
    ["write", () => fs.writeFile(target, replacement, { signal, mode: 0o600 })],
    ["mkdir", () => fs.mkdir("/cancelled", { signal, mode: 0 })],
    ["stat", () => fs.stat(target, { signal })],
    ["readdir", () => fs.readdir("/dir-0", { signal })],
    ["X_OK", () => fs.access(target, 1, { signal })],
    ["R_OK", () => fs.access(target, 4, { signal })],
    ["W_OK", () => fs.access(target, 2, { signal })],
  ] as const) {
    const requests = await observe(`preaborted ${name} reason=${reason.message}`, action, "ECANCELED");
    assert.equal(requests.length, 0);
  }
  const contract: FileSystem = fs;
  const requests = await observe(`OBSERVED preaborted unsupported chmod reason=${reason.message}`, () => contract.chmod!(target, 0o600, { signal }), "ENOTSUP");
  assert.equal(requests.length, 0);
}
for (const operation of ["getObject", "putObject"] as const) {
  activeController = new AbortController();
  abortDuring = operation;
  await observe(`abort during ${operation} with ENOENT reason`, () => operation === "getObject"
    ? fs.readFile(target, { signal: activeController!.signal, maxBytes: 64 })
    : fs.writeFile(target, replacement, { signal: activeController!.signal, mode: 0 }), "ECANCELED");
  abortDuring = undefined;
  await inspect(target, binary, 0);
}
await observe("final namespace", async () => {
  const entries = await fs.readdir("/");
  assert.equal(entries.length, 16);
  assert.ok(entries.every(entry => !["cancelled", "invalid", "missing"].includes(entry.name)));
  return entries;
});
console.log(JSON.stringify({
  classification: "OBSERVATIONS ONLY; not permission-profile acceptance or authority; generic required row remains RED",
  permissions: fs.capabilities.permissions, observationCount: observations.length, observations,
}, (_key, value: unknown) => value instanceof Uint8Array ? [...value] : value, 2));
