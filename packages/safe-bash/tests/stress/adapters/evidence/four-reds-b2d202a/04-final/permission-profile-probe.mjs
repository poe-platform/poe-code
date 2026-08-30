import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { MockS3Client, S3FileSystem } = await import(pathToFileURL(`${process.cwd()}/src/fs/s3/index.ts`));
const { FsError } = await import(pathToFileURL(`${process.cwd()}/src/contracts/errors.ts`));
const bucket = 'permission-observations';
const mock = new MockS3Client({ buckets: [bucket] });
const fs = new S3FileSystem({ transport: mock, bucket });
const bytes = new Uint8Array([0, 255, 17]);
const observations = [];
async function observe(name, action) {
  const before = mock.requests.length;
  try {
    const result = await action();
    observations.push({ name, resolved: true, result: result ?? null, operations: mock.requests.slice(before).map(request => request.operation) });
  } catch (error) {
    observations.push({ name, resolved: false, typedFsError: error instanceof FsError, code: error.code, path: error.path, operations: mock.requests.slice(before).map(request => request.operation) });
  }
}
await observe('explicit mode0600 creation', () => fs.writeFile('/mode', bytes, { mode: 0o600 }));
await observe('fresh instance mode stat', async () => {
  const next = new S3FileSystem({ transport: mock, bucket });
  return { mode: (await next.stat('/mode')).mode & 0o777, bytes: [...await next.readFile('/mode')] };
});
await observe('chmod unsupported', () => fs.chmod('/mode', 0o700));
await observe('file X_OK formerly masked by creation failure', () => fs.access('/mode', 1));
await observe('explicit directory mode0700', () => fs.mkdir('/private', { mode: 0o700 }));
await observe('directory X_OK', () => fs.access('/private', 1));
assert.equal(fs.capabilities.permissions, false);
assert.deepEqual(await fs.readFile('/mode'), bytes);
console.log(JSON.stringify({ classification: 'OBSERVATIONS ONLY: not adjudication or required-support acceptance', permissions: fs.capabilities.permissions, observations }, null, 2));
