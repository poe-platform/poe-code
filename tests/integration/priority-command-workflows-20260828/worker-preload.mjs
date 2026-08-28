import fs from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import workers from 'node:worker_threads';
import { admitFile, readJson, exact } from './admission.mjs';

const configuration = workers.getEnvironmentData('priority-worker-observation-v1');
if (!configuration || workers.isMainThread) throw new Error('WORKER_CONFIGURATION_REQUIRED');
const { files, log, requested, effective, token, preload, guard } = configuration;
exact(process.execArgv, effective.execArgv, 'EFFECTIVE_OPTIONS_DRIFT');
admitFile(import.meta.url, files);
admitFile(new URL('./admission.mjs', import.meta.url).href, files);
admitFile(preload, files);
admitFile(guard, files);
let captured = 0;
const emit = value => {
  const bytes = Buffer.from(JSON.stringify({ token, pid: process.pid, threadId: workers.threadId, ...value }) + '\n');
  captured += bytes.length;
  if (captured > configuration.captureBytes) throw new Error('WORKER_CAPTURE_STOP');
  fs.appendFileSync(log, bytes);
};
emit({ event: 'preload', requested, effective, resourceLimits: workers.resourceLimits });
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) { emit({ event: 'builtin-load', url }); return nextLoad(url, context); }
    admitFile(url, files);
    const loaded = nextLoad(url, context);
    const receipt = admitFile(url, files, loaded.source);
    emit({ event: 'load', url, ...receipt });
    return loaded;
  },
});
workers.Worker = class { constructor() { throw new Error('NESTED_WORKER_REFUSED'); } };
syncBuiltinESMExports();
await import(guard);
process.on('exit', code => emit({ event: 'thread-exit-hook', code }));
