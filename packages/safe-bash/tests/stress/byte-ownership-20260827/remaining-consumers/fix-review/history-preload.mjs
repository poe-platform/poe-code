import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const write = fs.writeFileSync;
fs.writeFileSync = function(path, ...rest) {
  const target = path === '/tmp/byte-remaining-direct-curl-findings.txt' ? join(process.env.REVIEW_HISTORY, 'redirected-direct-findings.txt') : path;
  return write.call(this, target, ...rest);
};
const spawn = childProcess.spawnSync;
childProcess.spawnSync = function(binary, args, options) {
  if (binary === 'apply_patch' && typeof options?.input === 'string') {
    const input = options.input.replaceAll('/tmp/byte-remaining-consumers-findings.txt', join(process.env.REVIEW_HISTORY, 'redirected-packed-findings.txt'));
    return spawn.call(this, binary, args, { ...options, input });
  }
  return spawn.call(this, binary, args, options);
};
syncBuiltinESMExports();
