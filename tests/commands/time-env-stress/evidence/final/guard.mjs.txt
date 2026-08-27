import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';

registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  assert.ok(!result.url.includes('/Users/kjopek/Workspace/'), `repository fallback: ${result.url}`);
  assert.ok(!/safe-bash-time-env-independent-[^/]+\/src\//.test(result.url), `uncompiled product: ${result.url}`);
  if (result.url.includes('/dist/') && !result.url.includes('/node_modules/')) {
    appendFileSync(`${process.env.REVIEW_OUTPUT}/imports.jsonl`, JSON.stringify({ specifier, resolved: result.url }) + '\n');
  }
  return result;
} });
