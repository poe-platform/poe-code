import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
  const original = childProcess[name];
  childProcess[name] = function (command, ...args) {
    if (command !== process.execPath) {
      appendFileSync(process.env.LENGTH_AUTHOR_NATIVE_DENIAL_LOG, `${JSON.stringify({ name, command })}\n`);
      throw new Error(`native process prohibited in string-length author regression: ${name}`);
    }
    return Reflect.apply(original, this, [command, ...args]);
  };
}
syncBuiltinESMExports();

