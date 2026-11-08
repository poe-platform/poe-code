import { lstat, readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = root + 'PUBLISHER-KEY-01/';
await mkdir(output, { mode: 0o700 });
const save = (name, value) => writeFile(output + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await save('STARTUP.json', { startedAt: new Date().toISOString(), children: 0, cryptographicParsing: false });
const result = { url: 'https://savannah.gnu.org/people/viewgpg.php?user_id=2590', bytes: 0 };
try {
  const path = root + 'AUTHORITY-CACHE-01/chet.html.data';
  const status = await lstat(path);
  assert(status.isFile() && !status.isSymbolicLink() && status.size < 131072);
  const bytes = await readFile(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '56b89c2bfb00f86ca518661d5addd5e3d0d1f7bfe14060be3e610d9035eab177');
  assert(bytes.toString('utf8').includes('href="/people/viewgpg.php?user_id=2590"'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let reader;
  let handle;
  try {
    const response = await fetch(result.url, { redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { 'accept-encoding': 'identity' } });
    result.status = response.status;
    result.headers = Object.fromEntries(['date', 'content-type', 'content-length', 'location'].map(name => [name, response.headers.get(name)]));
    if (response.status === 200) {
      const length = response.headers.get('content-length');
      assert(length === null || /^\d+$/.test(length) && Number(length) <= 4194304);
      handle = await open(output + 'maintainer-public-key.data', 'wx', 0o600);
      reader = response.body.getReader();
      const digest = createHash('sha256');
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        result.bytes += part.value.byteLength;
        assert(result.bytes <= 4194304);
        digest.update(part.value);
        await handle.writeFile(part.value);
      }
      if (length !== null) assert.equal(result.bytes, Number(length));
      result.sha256 = digest.digest('hex');
      result.capture = 'maintainer-public-key.data';
      result.role = 'PUBLISHER_LINKED_MAINTAINER_RESPONSE_NOT_YET_VALIDATED_KEY';
    } else await response.body?.cancel();
  } finally {
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
    if (handle) await handle.close();
    clearTimeout(timer);
  }
} catch (error) {
  process.exitCode = 1;
  result.error = { name: error.name, message: error.message };
} finally {
  await save('RESULT.json', { ...result, endedAt: new Date().toISOString(), children: 0 });
  console.log(JSON.stringify(result));
  const cachePath = root + 'AUTHORITY-CACHE-01/RESULT.json';
  const status = await lstat(cachePath);
  assert(status.isFile() && status.size < 1048576);
  console.log(await readFile(cachePath, 'utf8'));
}
