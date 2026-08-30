import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import workers from 'node:worker_threads';

const consumer = realpathSync(process.cwd());
const product = join(consumer, 'node_modules/virtual-bash/dist') + sep;
const allowed = new Set(['node:async_hooks', 'node:buffer', 'node:crypto', 'node:events', 'node:fs', 'node:fs/promises', 'node:http', 'node:https', 'node:net', 'node:path', 'node:stream', 'node:stream/promises', 'node:stream/web', 'node:timers/promises', 'node:url', 'node:util', 'node:worker_threads', 'node:zlib']);
const record = entry => appendFileSync(join(consumer, 'imports.ndjson'), JSON.stringify(entry) + '\n');
const OriginalWorker = workers.Worker;
workers.Worker = class PackedWorker extends OriginalWorker {
  constructor(filename, options) {
    const canonical = realpathSync(filename instanceof URL ? fileURLToPath(filename) : filename);
    if (canonical !== join(product, 'commands/regex-execution/worker.js') || options?.eval) throw new Error(`PRODUCT_WORKER_ENTRY_DENIED ${canonical}`);
    record({ worker: canonical, execArgv: options?.execArgv });
    super(filename, options);
  }
};
syncBuiltinESMExports();
registerHooks({ resolve(specifier, context, nextResolve) {
  const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
  const fromProduct = parent.startsWith(product);
  if (fromProduct && ['node:child_process', 'child_process', 'node:cluster', 'cluster'].includes(specifier)) throw new Error(`PRODUCT_NATIVE_FALLBACK_DENIED ${specifier}`);
  const result = nextResolve(specifier, context);
  if (result.url.startsWith('node:')) {
    if (fromProduct && !allowed.has(result.url)) throw new Error(`UNINSPECTED_PRODUCT_BUILTIN ${result.url}`);
    if (fromProduct && result.url === 'node:worker_threads' && !/\/commands\/regex-execution\/(?:client|worker)\.js$/u.test(parent)) throw new Error(`UNINSPECTED_WORKER_IMPORT ${parent}`);
    record({ specifier, parent: context.parentURL, resolved: result.url });
    return result;
  }
  if (!result.url.startsWith('file:')) throw new Error(`NON_FILE_IMPORT_DENIED ${result.url}`);
  const canonical = realpathSync(fileURLToPath(result.url));
  if (!canonical.startsWith(consumer + sep) || !/\.(?:mjs|js)$/u.test(canonical)) throw new Error(`SOURCE_FALLBACK_DENIED ${canonical}`);
  if ((fromProduct || canonical.includes('/node_modules/')) && !canonical.startsWith(product)) throw new Error(`EXTERNAL_PRODUCT_MODULE_DENIED ${canonical}`);
  record({ specifier, parent: context.parentURL, resolved: result.url, realpath: canonical });
  return result;
} });
