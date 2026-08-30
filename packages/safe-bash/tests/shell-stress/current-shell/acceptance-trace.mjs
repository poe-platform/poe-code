import { registerHooks } from 'node:module';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (process.env.CURRENT_SHELL_IMPORT_TRACE && url.startsWith('file:')) {
      const path = fileURLToPath(url.split('?')[0]);
      if (path.includes('/safe-bash/src/') && path.endsWith('.ts')) {
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        appendFileSync(process.env.CURRENT_SHELL_IMPORT_TRACE, `${JSON.stringify({ pid: process.pid, path, hash })}\n`);
      }
    }
    return loaded;
  },
});
