import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = process.env.SAFE_BASH_PUBLIC_CONSUMER_ROOT;
const endpoint = process.env.SAFE_BASH_S3_NAMESPACE_ENDPOINT;
const bucket = process.env.SAFE_BASH_S3_NAMESPACE_BUCKET;
const accessKeyId = process.env.SAFE_BASH_S3_NAMESPACE_ACCESS_KEY_ID;
const secretAccessKey = process.env.SAFE_BASH_S3_NAMESPACE_SECRET_ACCESS_KEY;
const image = process.env.SAFE_BASH_DOCKER_IMAGE;
const socketPath = process.env.SAFE_BASH_DOCKER_SOCKET;
if (![root, endpoint, bucket, accessKeyId, secretAccessKey, image, socketPath].every(Boolean)) throw new Error('Configure the public consumer, explicit S3 test credentials/bucket, and qualified Docker host');

async function load(name, leaf) {
  const directory = resolve(root, 'node_modules', '@poe-platform', name);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  return import(pathToFileURL(resolve(directory, manifest.exports[leaf].import)).href);
}
const { Shell } = await load('safe-bash', '.');
const { pythonCommands } = await load('safe-bash', './commands/python');
const { createDockerPythonExecutorPool } = await load('safe-bash', './commands/python/docker');
const { createS3NamespaceFileSystem } = await load('safe-fs', './fs/s3');
const { createS3HttpTransport } = await load('safe-fs', './fs/s3/http');
const { MemoryFileSystem, ReadOnlyFileSystem, MountFileSystem, withFileSystemQuota } = await load('safe-fs', '.');
assert.equal(typeof createS3NamespaceFileSystem, 'function', 'The standalone artifact must export the S3 namespace adapter');
const url = new URL(endpoint);
const client = createS3HttpTransport({ endpoint, region: 'us-east-1', credentials: { accessKeyId, secretAccessKey },
  allowInsecureHttp: url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname),
  verifiedConditionalOperations: { put: true }, maxGetBytes: 8388608, maxPutBytes: 8388608, requestTimeoutMs: 10000 });
const command = source => "python -c '" + source.split("'").join("'\\''") + "'";

test('real S3 service enforces exclusive and concurrent conditional writes', { timeout: 30000 }, async () => {
  const object = { Bucket: bucket, Key: 'poe-python-cas-probe-' + randomUUID() };
  try {
    await client.putObject({ ...object, Body: new Uint8Array([0]), IfNoneMatch: '*' });
    await assert.rejects(client.putObject({ ...object, Body: new Uint8Array([1]), IfNoneMatch: '*' }), error => error.$metadata?.httpStatusCode === 412);
    const head = await client.headObject(object);
    assert.equal(typeof head.ETag, 'string');
    const competing = await Promise.allSettled([2, 3].map(value => client.putObject({ ...object, Body: new Uint8Array([value]), IfMatch: head.ETag })));
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(competing.filter(result => result.status === 'rejected' && result.reason.$metadata?.httpStatusCode === 412).length, 1);
    const current = await client.getObject(object);
    assert.deepEqual(Uint8Array.from(current.Body), new Uint8Array([competing[0].status === 'fulfilled' ? 2 : 3]));
  } finally { await client.deleteObject(object); }
});

test('real Python cleans normal and exceptional temporary directories on a real S3 namespace', { timeout: 60000 }, async context => {
  const key = 'poe-python-namespace-' + randomUUID();
  const fs = await createS3NamespaceFileSystem({ client, bucket, key, maxOpenFiles: 4 });
  const pool = await createDockerPythonExecutorPool({ socketPath, image, memoryBytes: 268435456, cpus: 1, deadlineMs: 20000, maxConcurrentExecutors: 1 });
  const shell = new Shell({ fs }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const result = await shell.exec(command(`import tempfile, pathlib, zlib
with tempfile.TemporaryDirectory(dir="/") as directory:
    file = pathlib.Path(directory, "binary")
    file.write_bytes(bytes([0, 255, 42]))
    assert zlib.decompress(zlib.compress(file.read_bytes())) == bytes([0, 255, 42])
try:
    with tempfile.TemporaryDirectory(dir="/") as directory:
        pathlib.Path(directory, "exceptional").write_text("owned")
        raise RuntimeError("intentional")
except RuntimeError:
    pass
pathlib.Path("/result").write_bytes(bytes([0, 255, 42]))
print("remote cleanup complete", flush=True)`));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'remote cleanup complete\n');
    const independent = await createS3NamespaceFileSystem({ client, bucket, key });
    assert.deepEqual(await independent.readdir('/'), [{ name: 'result', type: 'file' }]);
    assert.deepEqual(await independent.readFile('/result'), new Uint8Array([0, 255, 42]));
    assert.equal(pool.inspect().active, 0);
    context.diagnostic('Real HTTP S3 service, native Python binary I/O, normal/exceptional cleanup and independent-client persistence passed');
  } finally {
    await shell.dispose(); await pool.dispose();
    await client.deleteObject({ Bucket: bucket, Key: key });
  }
});

test('real Python refuses raced cleanup without removing a replacement S3 directory', { timeout: 60000 }, async () => {
  const key = 'poe-python-raced-namespace-' + randomUUID();
  const fs = await createS3NamespaceFileSystem({ client, bucket, key });
  const peer = await createS3NamespaceFileSystem({ client, bucket, key });
  const original = fs.removeTreeConditional.bind(fs);
  let raced = false;
  let replacement;
  const removeTree = async (path, options) => {
    if (!raced) {
      raced = true;
      replacement = path;
      await peer.rename(path, '/moved-owned');
      await peer.mkdir(path);
      await peer.writeFile(path + '/unrelated', new Uint8Array([99]));
    }
    return original(path, options);
  };
  const racedFs = new Proxy(fs, { get(target, property, receiver) {
    return property === 'removeTreeConditional' ? removeTree : Reflect.get(target, property, receiver);
  } });
  const pool = await createDockerPythonExecutorPool({ socketPath, image, memoryBytes: 268435456, cpus: 1, deadlineMs: 20000, maxConcurrentExecutors: 1 });
  const shell = new Shell({ fs: racedFs }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const result = await shell.exec(command(`import tempfile, pathlib
with tempfile.TemporaryDirectory(dir="/") as directory:
    pathlib.Path(directory, "owned").write_bytes(bytes([42]))`));
    assert.equal(result.exitCode, 1, result.stdout);
    assert.equal(raced, true);
    assert.deepEqual(await peer.readFile(replacement + '/unrelated'), new Uint8Array([99]));
    assert.deepEqual(await peer.readFile('/moved-owned/owned'), new Uint8Array([42]));
    assert.equal(pool.inspect().active, 0);
  } finally {
    await shell.dispose(); await pool.dispose();
    await client.deleteObject({ Bucket: bucket, Key: key });
  }
});

test('real Python S3 cleanup respects readonly, quota and nested-mount boundaries', { timeout: 90000 }, async () => {
  const key = 'poe-python-policy-namespace-' + randomUUID();
  const fs = await createS3NamespaceFileSystem({ client, bucket, key });
  await fs.mkdir('/guarded/nested', { recursive: true });
  await fs.writeFile('/guarded/keep', new Uint8Array([99]));
  const protectedFs = new MemoryFileSystem();
  await protectedFs.writeFile('/mounted-keep', new Uint8Array([42]));
  const pool = await createDockerPythonExecutorPool({ socketPath, image, memoryBytes: 268435456, cpus: 1, deadlineMs: 20000, maxConcurrentExecutors: 1 });
  try {
    for (const filesystem of [new ReadOnlyFileSystem(fs), new MountFileSystem({ root: fs, mounts: { '/guarded/nested': protectedFs } })]) {
      const shell = new Shell({ fs: filesystem }).use(pythonCommands({ createExecutor: pool.createExecutor }));
      try {
        const result = await shell.exec(command('import shutil\nshutil.rmtree("/guarded")'));
        assert.equal(result.exitCode, 1, result.stdout);
        assert.deepEqual(await fs.readFile('/guarded/keep'), new Uint8Array([99]));
        assert.deepEqual(await protectedFs.readFile('/mounted-keep'), new Uint8Array([42]));
      } finally { await shell.dispose(); }
    }
    const shell = new Shell({ fs: withFileSystemQuota(fs, { maxBytes: 4 }) }).use(pythonCommands({ createExecutor: pool.createExecutor }));
    try {
      const result = await shell.exec(command(`import tempfile, pathlib
with tempfile.TemporaryDirectory(dir="/") as directory:
    pathlib.Path(directory, "too-large").write_bytes(bytes([1, 2, 3, 4, 5]))`));
      assert.equal(result.exitCode, 1, result.stdout);
      assert.deepEqual(await fs.readdir('/'), [{ name: 'guarded', type: 'directory' }]);
      assert.deepEqual(await fs.readFile('/guarded/keep'), new Uint8Array([99]));
    } finally { await shell.dispose(); }
    assert.equal(pool.inspect().active, 0);
  } finally { await pool.dispose(); await client.deleteObject({ Bucket: bucket, Key: key }); }
});

test('real Python cancellation before S3 cleanup publication preserves acknowledged files', { timeout: 60000 }, async () => {
  const key = 'poe-python-cancel-namespace-' + randomUUID();
  let arm = false;
  let entered;
  const blocked = new Promise(resolve => { entered = resolve; });
  const gated = { ...client,
    async putObject(input, options) {
      if (arm && !Object.hasOwn(JSON.parse(new TextDecoder().decode(input.Body)).nodes, '/owned')) {
        entered();
        await new Promise((_resolve, reject) => {
          if (options.abortSignal.aborted) reject(options.abortSignal.reason);
          else options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true });
        });
      }
      return client.putObject(input, options);
    },
  };
  const fs = await createS3NamespaceFileSystem({ client: gated, bucket, key });
  await fs.mkdir('/owned');
  await fs.writeFile('/owned/keep', new Uint8Array([99]));
  arm = true;
  const controller = new AbortController();
  const reason = new Error('cancel unpublished cleanup');
  const pool = await createDockerPythonExecutorPool({ socketPath, image, memoryBytes: 268435456, cpus: 1, deadlineMs: 20000, maxConcurrentExecutors: 1 });
  const shell = new Shell({ fs }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  const running = assert.rejects(shell.exec(command('import shutil\nshutil.rmtree("/owned")'), { signal: controller.signal }), error => error === reason);
  try {
    await blocked;
    controller.abort(reason);
    await running;
    assert.deepEqual(await fs.readFile('/owned/keep'), new Uint8Array([99]));
    assert.equal(pool.inspect().active, 0);
  } finally { controller.abort(reason); await running; await shell.dispose(); await pool.dispose(); await client.deleteObject({ Bucket: bucket, Key: key }); }
});
