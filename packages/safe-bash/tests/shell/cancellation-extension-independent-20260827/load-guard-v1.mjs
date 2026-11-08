import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export async function load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  assert.ok(url.startsWith('file:'), `non-file import refused: ${url}`);
  const filename = realpathSync(fileURLToPath(url));
  const allowed = JSON.parse(process.env.REVIEW_ALLOWED_FILES);
  assert.ok(allowed.includes(filename), `unbound file import refused: ${filename}`);
  const result = await nextLoad(url, context);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const source = readFileSync(filename);
  const loaded = result.source === null || result.source === undefined ? source : result.source;
  const record = { url, filename, format: result.format, diskSha256: digest(source), loadedSha256: digest(loaded) };
  assert.equal(record.diskSha256, record.loadedSha256, 'loaded bytes must equal bound artifact');
  if (filename === realpathSync(process.env.CANCELLATION_MODULE)) {
    assert.equal(record.diskSha256, process.env.CANCELLATION_MODULE_SHA256, 'exact helper artifact');
  }
  appendFileSync(process.env.REVIEW_LOAD_LOG, JSON.stringify(record) + '\n');
  return result;
}
