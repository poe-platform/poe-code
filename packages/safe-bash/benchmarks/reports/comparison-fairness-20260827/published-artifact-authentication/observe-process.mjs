import fs from 'node:fs';
import childProcess from 'node:child_process';
import { register, syncBuiltinESMExports } from 'node:module';

const log = process.env.AUTH_IMPORT_LOG;
const record = value => fs.appendFileSync(log, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...value })}\n`);
record({ event: 'process-start', argv: process.argv, execArgv: process.execArgv, cwd: process.cwd() });
for (const method of ['spawn', 'spawnSync', 'fork', 'exec', 'execSync', 'execFile', 'execFileSync']) {
  childProcess[method] = (...args) => {
    record({ event: 'forbidden-extra-process-attempt', method, executable: String(args[0]) });
    throw new Error('Representative budget forbids extra product/helper processes');
  };
}
syncBuiltinESMExports();
register(new URL('./observe-load.mjs', import.meta.url), { data: { root: process.env.AUTH_CLOSURE, log } });
process.on('disconnect', () => record({ event: 'ipc-disconnect' }));
process.on('exit', code => record({ event: 'process-exit', code }));
