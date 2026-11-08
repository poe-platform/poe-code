import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { appendFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const allowed = pathToFileURL(realpathSync(process.env.PACKED_ROOT) + '/').href;
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  assert.ok(!result.url.includes('/Users/kjopek/Workspace/'), result.url);
  if (result.url.includes('/dist/')) {
    assert.ok(result.url.startsWith(allowed), result.url);
    appendFileSync(`${process.env.REVIEW_OUTPUT}/packed-imports.jsonl`, JSON.stringify({ specifier, url: result.url }) + '\n');
  }
  return result;
} });
