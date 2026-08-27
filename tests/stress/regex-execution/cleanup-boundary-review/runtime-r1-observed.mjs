import childProcess from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [driver, ...args] = process.argv.slice(2);
if (!['guard', 'old-five'].includes(driver)) throw new Error('prepared driver required');
const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const fork = childProcess.fork;
childProcess.fork = (entry, childArgs, options) => {
  if (childArgs[0] === 'packed') {
    const contents = readFileSync(resolve(owned, 'runtime-r1-package-resolver.mjs'));
    const target = resolve(dirname(entry), 'runtime-r1-package-resolver.mjs');
    try { writeFileSync(target, contents, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || !readFileSync(target).equals(contents)) throw error; }
  }
  return fork(entry, childArgs, { ...options, execArgv: [...options.execArgv, '--import', resolve(owned, 'runtime-r1-observer.mjs')] });
};
syncBuiltinESMExports();
process.argv = [process.argv[0], resolve(owned, `${driver}.mjs`), ...args];
await import(pathToFileURL(resolve(owned, `${driver}.mjs`)));
