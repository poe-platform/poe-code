import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { authenticatePacket } from './authorization.mjs';
import { boundFile } from '../executor-v3/projection.mjs';
import { hash, requireThat } from './safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const recipe = authenticatePacket(root);
const seal = JSON.parse(fs.readFileSync(path.join(root, 'SEAL.json')));
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
for (const tool of projection.tools) boundFile(tool.path, tool);
const node = projection.tools.find(tool => tool.role === 'node').path;
const absent = identifier => { try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
const rows = [];
for (const file of seal.files.filter(file => !file.path.startsWith('../') && file.path.endsWith('.mjs'))) {
  const args = ['--unhandled-rejections=strict', '--check', path.join(root, file.path)];
  const child = spawnSync(node, args, { detached: true, encoding: 'utf8', timeout: 10000, maxBuffer: 65536, env: { PATH: '', LANG: 'C', HOME: root } });
  const reaped = Boolean(child.pid && absent(child.pid) && absent(-child.pid));
  rows.push({ path: file.path, args, pid: child.pid, status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, error: child.error?.message ?? null, reaped, pass: child.status === 0 && child.signal === null && reaped && !child.error });
  if (!reaped) break;
}
requireThat(authenticatePacket(root) === recipe, 'POST_RECIPE_BINDING', recipe);
const review = fs.readFileSync(path.join(root, '../../breadth-continuation-independent-20260828/executor-v3-review/SEAL.json'));
requireThat(hash(review) === '16acd3dd7e196d0deffccb5b29d59c91fc45ad3e136d480e1c47143fbf22c591', 'REVIEW_HISTORY', hash(review));
process.stdout.write(`${JSON.stringify({ kind: 'v4-syntax-and-immutable-bindings-only', recipe, protectedFiles: seal.files.length, rows, passed: rows.filter(row => row.pass).length, failed: rows.filter(row => !row.pass).length, engineImports: 0, packageStaging: 0 })}\n`);
if (rows.some(row => !row.pass)) process.exitCode = 1;
