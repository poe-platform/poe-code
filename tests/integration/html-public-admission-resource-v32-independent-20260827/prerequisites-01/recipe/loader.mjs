import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let allowed, logfile;
export function initialize(data) { allowed = data.allowed; logfile = data.logfile; }
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) {
    const target = fileURLToPath(url);
    assert.ok(allowed[target], `UNBOUND_MODULE:${target}`);
    const actual = createHash('sha256').update(result.source).digest('hex');
    assert.equal(actual, allowed[target], target);
    appendFileSync(logfile, `${JSON.stringify({ pid: process.pid, url, sha256: actual, nextLoad: true, transformed: false })}\n`);
  } else assert.ok(url.startsWith('node:'), `NONLOCAL_MODULE:${url}`);
  return result;
}
