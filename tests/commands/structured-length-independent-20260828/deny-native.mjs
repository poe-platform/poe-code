import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const original = childProcess[name];
  childProcess[name] = function (command, ...args) {
    if (command !== process.execPath) {
      appendFileSync(process.env.LENGTH_NATIVE_DENIAL_LOG, `${JSON.stringify({ name, command })}\n`);
      throw new Error(`native process prohibited in this independent cohort: ${name}`);
    }
    return Reflect.apply(original, this, [command, ...args]);
  };
}
syncBuiltinESMExports();
