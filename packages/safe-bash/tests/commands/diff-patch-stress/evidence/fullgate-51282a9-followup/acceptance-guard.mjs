import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = realpathSync(process.cwd()) + '/';
const tooling = realpathSync(process.env.FOLLOWUP_TOOLING) + '/';
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) {
      const path = realpathSync(fileURLToPath(url));
      assert(path.startsWith(root) || path.startsWith(tooling), `import escaped snapshot/tooling: ${path}`);
    } else assert(url.startsWith('node:') || url.startsWith('data:'), url);
    return nextLoad(url, context);
  },
});
