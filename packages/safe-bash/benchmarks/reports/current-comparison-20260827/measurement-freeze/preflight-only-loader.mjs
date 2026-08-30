import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const configuration = JSON.parse(readFileSync(new URL('./preflight-allowlist.json', import.meta.url), 'utf8'));
let events = 0;
export async function load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  const expected = configuration.files[filename];
  assert.ok(expected, `Static PREFLIGHT denies unbound module: ${filename}`);
  const result = await nextLoad(url, context);
  const bytes = typeof result.source === 'string' ? Buffer.from(result.source) : Buffer.from(result.source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, expected.bytes);
  assert.equal(sha256, expected.sha256);
  assert.ok(++events <= 64, 'preflight module event cap');
  appendFileSync(configuration.log, `${JSON.stringify({ event: 'static-runtime-load-returned', path: filename, bytes: bytes.length, sha256 })}\n`, { mode: 0o600 });
  return result;
}
