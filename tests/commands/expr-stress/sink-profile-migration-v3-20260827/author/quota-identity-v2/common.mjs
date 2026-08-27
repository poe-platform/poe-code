import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
export function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [{ path: relative, type: 'symlink', target: readlinkSync(path) }];
    if (stat.isDirectory()) return [{ path: relative, type: 'directory' }, ...inventory(path, relative)];
    return [{ path: relative, type: 'file', size: stat.size, sha256: hash(readFileSync(path)) }];
  });
}
