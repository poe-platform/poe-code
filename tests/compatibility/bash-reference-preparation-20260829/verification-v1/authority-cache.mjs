import { lstat, readdir, writeFile, mkdir, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./AUTHORITY-CACHE-01/', import.meta.url));
const started = performance.now();
await mkdir(root, { mode: 0o700 });
const save = (name, value) => writeFile(root + name, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await save('STARTUP.json', { startedAt: new Date().toISOString(), children: 0, maxMs: 180000 });
const publisher = { url: 'https://savannah.gnu.org/users/chet', bytes: 0 };
const directories = [];
const selected = [];
let total = 0;
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let handle;
  let reader;
  try {
    const response = await fetch(publisher.url, { redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { 'accept-encoding': 'identity' } });
    publisher.status = response.status;
    publisher.headers = Object.fromEntries(['date', 'content-type', 'content-length', 'location'].map(name => [name, response.headers.get(name)]));
    if (response.status === 200) {
      handle = await open(root + 'chet.html.data', 'wx', 0o600);
      reader = response.body.getReader();
      const digest = createHash('sha256');
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        publisher.bytes += part.value.byteLength;
        assert(publisher.bytes <= 131072);
        digest.update(part.value);
        await handle.writeFile(part.value);
      }
      publisher.sha256 = digest.digest('hex');
      publisher.capture = 'chet.html.data';
    } else await response.body?.cancel();
  } catch (error) {
    publisher.error = { name: error.name, message: error.message };
    if (error.name === 'AssertionError' || error.code) throw error;
  } finally {
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
    if (handle) await handle.close();
    clearTimeout(timer);
    await save('PUBLISHER.json', publisher);
  }
  for (const directory of ['/System/Library/dyld', '/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld']) {
    let names;
    try { names = (await readdir(directory)).sort(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; directories.push({ directory, disposition: 'ABSENT' }); continue; }
    assert(names.length <= 64);
    directories.push({ directory, names });
    for (const name of names) {
      if (!/^dyld_shared_cache_arm64e?(?:\.[A-Za-z0-9.]+)?$/.test(name)) continue;
      const path = directory + '/' + name;
      const status = await lstat(path, { bigint: true });
      selected.push({ path, bytes: Number(status.size), mode: Number(status.mode & 0o777n).toString(8), regular: status.isFile() && !status.isSymbolicLink() });
      total += Number(status.size);
    }
  }
  if (selected.length > 32 || total > 25769803776 || selected.some(row => !row.regular || row.bytes > 4294967296)) {
    await save('CACHE-UNADMITTED.json', { directories, selected, total, reason: 'PRESEALED_SET_OR_SIZE_ADMISSION_BOUND' });
  } else {
    for (const row of selected) {
      const before = await lstat(row.path, { bigint: true });
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(row.path, { highWaterMark: 65536 })) {
        assert(performance.now() - started < 180000);
        digest.update(chunk);
      }
      const after = await lstat(row.path, { bigint: true });
      assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs);
      row.sha256 = digest.digest('hex');
    }
    await save('CACHE.json', { directories, selected, total, qualification: 'STATIC_PUBLIC_CACHE_SET_NOT_RUNTIME_SELECTED_IMAGE_PROOF' });
  }
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', { name: error.name, message: error.message, directories, selected });
} finally {
  await save('RESULT.json', { publisher, cacheFiles: selected.length, total, elapsedMs: performance.now() - started, status: process.exitCode ? 'STOP' : 'METADATA_COMPLETE', children: 0 });
}
