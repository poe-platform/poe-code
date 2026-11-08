import { registerHooks } from 'node:module';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';

const root = realpathSync(process.cwd());
const log = join(root, 'imports.ndjson');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/node_modules/virtual-bash/') && ['node:child_process', 'child_process', 'node:worker_threads', 'worker_threads', 'node:cluster', 'cluster'].includes(specifier)) {
      throw new Error(`PRODUCT_NATIVE_FALLBACK_DENIED ${specifier}`);
    }
    const result = nextResolve(specifier, context);
    if (result.url.startsWith('node:')) return result;
    if (!result.url.startsWith('file:')) throw new Error(`NON_FILE_IMPORT_DENIED ${result.url}`);
    const canonical = realpathSync(fileURLToPath(result.url));
    if (!canonical.startsWith(root + sep) || !/\.(?:mjs|js)$/u.test(canonical)) throw new Error(`SOURCE_FALLBACK_DENIED ${canonical}`);
    appendFileSync(log, JSON.stringify({ specifier, parent: context.parentURL, resolved: result.url, realpath: canonical }) + '\n');
    return result;
  },
});
