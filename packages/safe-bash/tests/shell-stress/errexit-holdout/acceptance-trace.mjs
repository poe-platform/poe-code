import { registerHooks } from 'node:module';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url.startsWith('file:') && process.env.ERREXIT_HOLDOUT_TRACE) {
      const path = fileURLToPath(url.split('?')[0]);
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      appendFileSync(process.env.ERREXIT_HOLDOUT_TRACE, `${JSON.stringify({ pid: process.pid, path, hash })}\n`);
    }
    return loaded;
  },
});
