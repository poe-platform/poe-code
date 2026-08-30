import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';

const evidence = process.argv[3];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    assert.ok(!result.url.includes('/Users/kjopek/Workspace/'), `outside-source import: ${result.url}`);
    if (specifier === 'virtual-bash' || specifier.startsWith('virtual-bash/')) {
      assert.match(result.url, /\/consumer\/node_modules\/virtual-bash\/dist\//);
      appendFileSync(`${evidence}/independent-imports.jsonl`, JSON.stringify({ specifier, resolved: result.url }) + '\n');
    }
    return result;
  },
});
