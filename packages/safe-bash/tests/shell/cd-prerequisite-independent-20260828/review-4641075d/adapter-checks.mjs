import assert from 'node:assert/strict';
import { mkdir, readdir, rmdir } from 'node:fs/promises';

export async function adapterChecks(api, config) {
  assert(config.realRoot.startsWith(config.route.authorizedWriteRoot + '/'));
  const results = [];
  for (const name of ['Real', 'S3-mock']) {
    let filesystem;
    let client;
    if (name === 'Real') { await mkdir(config.realRoot); filesystem = new api.RealFileSystem({ root: config.realRoot }); }
    else { client = new api.MockS3Client({ buckets: ['cd-independent'] }); filesystem = new api.S3FileSystem({ transport: client, bucket: 'cd-independent' }); }
    await filesystem.mkdir('/w'); await filesystem.mkdir('/d');
    const offset = client?.requests.length;
    const calls = [];
    let signal;
    const guarded = new Proxy(filesystem, { get(target, key) { const value = Reflect.get(target, key, target); if (typeof value !== 'function') return value; return async (...args) => { assert(['stat', 'access'].includes(key)); assert.equal(key, calls.length === 0 ? 'stat' : 'access'); assert.equal(args[0], '/d'); assert(calls.length < 2); const options = args[key === 'stat' ? 1 : 2]; assert(options.signal instanceof AbortSignal && !options.signal.aborted); signal ??= options.signal; assert.equal(options.signal, signal); if (key === 'access') assert.equal(args[1], 1); calls.push({ method: key, path: args[0], mode: key === 'access' ? args[1] : undefined }); return value.apply(target, args); }; } });
    const observations = [];
    const commands = new api.CommandRegistry([{ name: 'observe', execute(context) { observations.push({ cwd: context.cwd, args: [...context.args], env: { ...context.env } }); return { exitCode: Number(context.args[0]) }; } }]);
    const shell = new api.Shell({ fs: guarded, commands, cwd: '/w', env: { OLDPWD: '/old' } });
    try {
      const result = await shell.exec('cd /d; observe "$?" "$PWD" "$OLDPWD"');
      assert.equal(result.exitCode, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
      assert.deepEqual(observations, [{ cwd: '/d', args: ['0', '/d', '/w'], env: { OLDPWD: '/w', PWD: '/d' } }]);
      assert.equal(calls.length, 2);
      const requests = client?.requests.slice(offset);
      if (requests) { assert(requests.length > 0 && requests.length <= 8); assert(requests.every(request => request.operation === 'headObject' && request.input.Bucket === 'cd-independent' && ['d', 'd/'].includes(request.input.Key))); }
      results.push({ name, status: 'pass', calls, requests, observations, service: false });
    } finally {
      await shell.dispose();
      if (name === 'Real') { assert.deepEqual((await readdir(config.realRoot)).sort(), ['d', 'w']); await rmdir(`${config.realRoot}/d`); await rmdir(`${config.realRoot}/w`); await rmdir(config.realRoot); }
    }
  }
  return results;
}
