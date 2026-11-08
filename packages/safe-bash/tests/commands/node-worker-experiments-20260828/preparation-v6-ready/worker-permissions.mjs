import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('.', import.meta.url);
export function workerPermissions() {
  const path = new URL('./MODULES.json', root); const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw Error('permission manifest admission');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const paths = [...manifest.files.filter(file => file.roles.includes('worker')).map(file => file.path), 'MODULES.json', 'package.json', 'compiled/engine/package.json'];
  if (paths.length > 160 || new Set(paths).size !== paths.length) throw Error('permission path cardinality');
  return ['--permission', ...paths.map(path => '--allow-fs-read=' + fileURLToPath(new URL(path, root)))];
}
export function assertWorkerPermissions() {
  if (!process.permission || typeof process.permission.has !== 'function') throw Error('Worker permission model absent');
  if (!process.permission.has('fs.read', fileURLToPath(new URL('./MODULES.json', root))) || process.permission.has('fs.read', '/etc/passwd') || process.permission.has('fs.write', fileURLToPath(new URL('./runtime/forbidden', root)))) throw Error('Worker FS authority mismatch');
}
