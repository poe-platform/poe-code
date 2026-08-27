import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { MockS3Client, S3FileSystem, type S3ObjectInput, type S3RequestOptions, type S3Transport } from "../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "../../fs/webdav/mock.js";
import { run } from "./helpers.js";

for (const backend of ["s3", "webdav"] as const) for (const command of ["stat", "mktemp"] as const) test(`${backend} ${command} forwards cancellation into actual remote reads`, async () => {
  let entered!: () => void;
  let remoteSignal: AbortSignal | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = async (signal: AbortSignal | undefined | null): Promise<never> => {
    assert.ok(signal);
    remoteSignal = signal;
    entered();
    return new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  let fs: FileSystem;
  if (backend === "s3") {
    const backing = new MockS3Client({ buckets: ["metadata"] });
    const transport: S3Transport = new Proxy(backing, { get(target, property) {
      if (property === "headObject") return async (_input: S3ObjectInput, options?: S3RequestOptions) => blocked(options?.abortSignal);
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    fs = new S3FileSystem({ bucket: "metadata", transport });
  } else {
    const mock = new MockDav();
    fs = new WebDavFileSystem({ baseUrl: "https://metadata.test/dav/", fetch: async (url, init) => init.method === "PROPFIND" ? blocked(init.signal) : mock.fetch(url, init) });
  }
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "caller cancellation is not missing-path success" });
  const operation = run(command, command === "stat" ? ["-c%s", "file"] : ["-qu", "preview.XXXX"], fs, {}, { signal: controller.signal });
  const rejected = assert.rejects(operation, error => error === reason);
  await started;
  controller.abort(reason);
  await rejected;
  assert.equal(remoteSignal?.aborted, true);
});
