import { register, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';

const log = process.env.REPLAY_IMPORT_LOG;
const record = entry => appendFileSync(log, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...entry }) + '\n');
record({ event: 'process-start', argv: process.argv, execArgv: process.execArgv, cwd: process.cwd() });
for (const method of ['spawn', 'fork']) {
  const original = childProcess[method];
  childProcess[method] = function (...args) {
    const child = original.apply(this, args);
    record({ event: 'child-start', method, childPid: child.pid, executable: args[0], args: args[1] });
    child.once('exit', (code, signal) => record({ event: 'child-exit', childPid: child.pid, code, signal }));
    return child;
  };
}
syncBuiltinESMExports();
register(new URL('loader.mjs', import.meta.url), { data: { freeze: process.env.REPLAY_FREEZE, log } });
process.on('exit', code => record({ event: 'process-exit', code }));
