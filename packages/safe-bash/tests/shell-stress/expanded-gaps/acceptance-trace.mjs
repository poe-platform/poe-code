import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
const trace = process.env.GAPS_ACCEPTANCE_TRACE;
if (trace) {
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url.startsWith('file:')) {
      const path = fileURLToPath(url.split('?')[0]);
      if (path.includes('/safe-bash/src/') || path.includes('/safe-bash/tests/')) appendFileSync(trace, JSON.stringify({ pid: process.pid, path, hash: createHash('sha256').update(readFileSync(path)).digest('hex') }) + '\n');
    }
    return loaded;
  } });
  for (const name of ['spawn', 'spawnSync']) {
    const original = childProcess[name];
    childProcess[name] = function(executable, args, options) {
      if (executable === process.execPath && Array.isArray(args)) return original.call(this, executable, ['--import', fileURLToPath(import.meta.url), ...args], { ...options, env: { ...(options?.env ?? process.env), GAPS_ACCEPTANCE_TRACE: trace } });
      return original.call(this, executable, args, options);
    };
  }
  syncBuiltinESMExports();
}
