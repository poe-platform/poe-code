import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('./HTTP-01/', import.meta.url));
const started = performance.now();
const requests = [
  ['GET', 'https://ftp.gnu.org/gnu/bash/'],
  ['GET', 'https://ftp.gnu.org/gnu/bash/bash-5.3-patches/'],
  ['HEAD', 'https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz'],
  ['HEAD', 'https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz.sig'],
];
await mkdir(directory, { recursive: false, mode: 0o700 });
const store = async (name, value) => writeFile(directory + name, value, { flag: 'wx', mode: 0o600 });
await store('STARTUP.json', JSON.stringify({ startedAt: new Date().toISOString(), requests, children: 0, archiveBodyFetches: 0 }, null, 2) + '\n');
const results = [];
try {
  for (const [method, url] of requests) {
    if (performance.now() - started >= 70000) throw new Error('Overall metadata deadline');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request metadata deadline')), Math.min(15000, 70000 - (performance.now() - started)));
    const result = { method, url, startedAt: new Date().toISOString() };
    let reader;
    try {
      const response = await fetch(url, { method, redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { accept: 'text/html', 'accept-encoding': 'identity' } });
      result.status = response.status;
      result.headers = Object.fromEntries(['date', 'last-modified', 'etag', 'content-type', 'content-length', 'location'].map(name => [name, response.headers.get(name)]));
      if (method === 'GET') {
        const chunks = [];
        let length = 0;
        reader = response.body?.getReader();
        if (reader) {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > 131072) throw new Error('Capture bound exceeded');
            chunks.push(part.value);
          }
        }
        const body = Buffer.concat(chunks, length);
        const name = `${results.length + 1}.body.data`;
        await store(name, body);
        result.body = { path: name, bytes: length, sha256: createHash('sha256').update(body).digest('hex') };
      }
      result.disposition = response.status === 200 ? 'HTTP_METADATA_ONLY' : 'HTTP_STATUS_NOT_ACCEPTED';
    } catch (error) {
      result.disposition = 'REQUEST_FAILED_NOT_RELEASE_EVIDENCE';
      result.error = { name: error?.name, message: error?.message, causeCode: error?.cause?.code };
      if (error?.message === 'Capture bound exceeded') throw error;
    } finally {
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
      clearTimeout(timer);
      result.endedAt = new Date().toISOString();
      results.push(result);
      await store(`${results.length}.json`, JSON.stringify(result, null, 2) + '\n');
    }
  }
} catch (error) {
  process.exitCode = 1;
  await store('FAILURE.json', JSON.stringify({ name: error?.name, message: error?.message }, null, 2) + '\n');
} finally {
  await store('RESULT.json', JSON.stringify({ startedAt: results[0]?.startedAt, endedAt: new Date().toISOString(), elapsedMs: performance.now() - started, results, children: 0, archiveBodyFetches: 0, codeExecutions: 0 }, null, 2) + '\n');
}
