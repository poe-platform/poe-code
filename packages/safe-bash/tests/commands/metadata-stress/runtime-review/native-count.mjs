import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawnSync;
const counts = {};
childProcess.spawnSync = function(command, args, options) {
  const flattened = [command, ...(Array.isArray(args) ? args : [])].join(' ');
  const gnu = /coreutils-9\.7\/src\/(chmod|stat|mktemp)/u.exec(flattened);
  const apple = /\/(?:usr\/)?bin\/(chmod|stat|mktemp)/u.exec(flattened);
  const label = gnu ? `GNU9.7:${gnu[1]}${args.includes('--version') ? ':version' : ':behavior'}` : apple ? `Apple:${apple[1]}:behavior` : 'other';
  counts[label] = (counts[label] ?? 0) + 1;
  return original.call(this, command, args, options);
};
syncBuiltinESMExports();
process.on('exit', () => {
  if (Object.keys(counts).length) console.error('LEAF_NATIVE_COUNTS', JSON.stringify(counts));
});
