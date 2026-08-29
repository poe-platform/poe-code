import { lstat, readFile, writeFile, mkdir, realpath, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = root + 'PREPARE-01/';
const started = performance.now();
const paths = [
  ['/Library/Developer/CommandLineTools/usr/bin/otool', 'BINARY'],
  ['/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/otool', 'BINARY'],
  ['/usr/bin/otool', 'BINARY'],
  ['/usr/lib/dyld', 'BINARY'],
  ['/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpgv', 'BINARY'],
  ['/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpg', 'BINARY'],
  ['/System/Library/CoreServices/SystemVersion.plist', 'TEXT'],
  ['/opt/homebrew/Cellar/gnupg/2.5.21/share/man/man1/gpgv.1', 'TEXT'],
];
const urls = [
  ['https://savannah.gnu.org/maintenance/GpgKeyrings/', 131072, 'keyring-guidance.html'],
  ['https://savannah.gnu.org/projects/bash/', 131072, 'bash-project.html'],
  ['https://savannah.gnu.org/p/release-gpgkeys.php?group=bash', 131072, 'release-key-page.html'],
  ['https://savannah.gnu.org/p/release-gpgkeys.php?group=bash&download=1', 4194304, 'release-keys.data'],
  ['https://savannah.gnu.org/maintenance/UsingGpg/', 131072, 'gpg-guidance.html'],
];
await mkdir(output, { mode: 0o700 });
const save = (name, value) => writeFile(output + name, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await save('STARTUP.json', { startedAt: new Date().toISOString(), paths, urls, children: 0, rootBudgetMs: 1500000 });
const metadata = [];
const responses = [];
try {
  for (const [path, role] of paths) {
    try {
      const resolved = await realpath(path);
      assert(['/Library/Developer/', '/Applications/Xcode.app/', '/usr/', '/opt/homebrew/', '/System/Library/'].some(prefix => resolved.startsWith(prefix)));
      const before = await lstat(resolved, { bigint: true });
      assert(before.isFile() && before.size <= BigInt(role === 'TEXT' ? 131072 : 268435456));
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(resolved, { highWaterMark: 65536 })) digest.update(chunk);
      const after = await lstat(resolved, { bigint: true });
      assert(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs);
      const entry = { path, resolved, role, bytes: Number(before.size), mode: Number(before.mode & 0o777n).toString(8), sha256: digest.digest('hex') };
      if (role === 'TEXT') {
        entry.capture = path.split('/').at(-1) + '.data';
        await writeFile(output + entry.capture, await readFile(resolved), { mode: 0o600, flag: 'wx' });
      }
      metadata.push(entry);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      metadata.push({ path, role, disposition: 'ABSENT' });
    }
  }
  await save('METADATA.json', metadata);
  for (const [url, cap, name] of urls) {
    const result = { url, cap, name, startedAt: new Date().toISOString(), bytes: 0 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let handle;
    let reader;
    try {
      const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { 'accept-encoding': 'identity' } });
      result.status = response.status;
      result.headers = Object.fromEntries(['date', 'content-type', 'content-length', 'location'].map(name => [name, response.headers.get(name)]));
      if (response.status !== 200) { await response.body?.cancel(); result.disposition = 'HTTP_UNAVAILABLE'; continue; }
      const length = response.headers.get('content-length');
      assert(length === null || /^\d+$/.test(length) && Number(length) <= cap);
      handle = await open(output + name + '.data', 'wx', 0o600);
      const digest = createHash('sha256');
      reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        result.bytes += part.value.byteLength;
        assert(result.bytes <= cap);
        digest.update(part.value);
        await handle.writeFile(part.value);
      }
      if (length !== null) assert.equal(result.bytes, Number(length));
      result.sha256 = digest.digest('hex');
      result.capture = name + '.data';
      result.disposition = 'PUBLISHER_RESPONSE_NOT_YET_ATTRIBUTED_SIGNER';
    } catch (error) {
      result.error = { name: error.name, message: error.message, causeCode: error.cause?.code };
      if (error.name === 'AssertionError' || error.code) throw error;
    } finally {
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
      if (handle) await handle.close();
      clearTimeout(timer);
      result.endedAt = new Date().toISOString();
      responses.push(result);
      await save(`response-${responses.length}.json`, result);
    }
  }
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', { name: error.name, message: error.message });
} finally {
  await save('RESULT.json', { metadata, responses, elapsedMs: performance.now() - started, endedAt: new Date().toISOString(), children: 0, status: process.exitCode ? 'STOP' : 'PREPARATION_COMPLETE_NOT_VERIFICATION' });
}
