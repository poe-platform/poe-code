import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(own, '../../../..');
export const candidate = path.resolve(own, '../../breadth-continuation-20260828/executor-v5');
export const recipeCommit = 'd6369210fccf5623c786bd9d4c9409a6384d0ad3';
export const evidenceCommit = 'd8559e1f3de0308b96bc2e8e1c2b0e682fc1df25';
export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
export function snapshot() {
  const sealBytes = fs.readFileSync(path.join(candidate, 'SEAL.json'));
  if (digest(sealBytes) !== 'afb0a451dba689d0337211892c73fcee2d84ffa83567ca8eb1ae1e8e73568986') throw Error('SEAL_IDENTITY');
  const seal = JSON.parse(sealBytes);
  if (seal.files.length !== 216) throw Error('SEAL_COUNT');
  const entries = [...seal.files, { path: 'SEAL.json', bytes: sealBytes.length, mode: 420, sha256: digest(sealBytes) }, { path: 'runs/handoff/EVIDENCE-MANIFEST.json', sha256: 'ef2a3dc0ab950a3375c7f84ed06f2579010e35919c784b45ea99a6385db5c2c9', commit: evidenceCommit }];
  const files = entries.map(entry => {
    const filename = path.resolve(candidate, entry.path);
    const relative = path.relative(repository, filename);
    if (relative.startsWith('..') || /(^|\/)AGENTS\.md$/.test(relative)) throw Error('FORBIDDEN_INPUT');
    const info = fs.lstatSync(filename);
    const bytes = fs.readFileSync(filename);
    const committed = git(['show', `${entry.commit ?? recipeCommit}:${relative}`]);
    if (!info.isFile() || info.isSymbolicLink() || (entry.bytes !== undefined && bytes.length !== entry.bytes) || (entry.mode !== undefined && (info.mode & 0o7777) !== entry.mode) || digest(bytes) !== entry.sha256 || !bytes.equals(committed)) throw Error(`INPUT_DRIFT:${relative}`);
    return { path: relative, bytes: bytes.length, mode: info.mode & 0o7777, sha256: digest(bytes), commit: entry.commit ?? recipeCommit };
  });
  const namespace = fs.readdirSync(candidate).filter(name => name !== 'runs').sort();
  return { kind: 'INDEPENDENT_ACTUAL_BODY_IDENTITY', date: new Date().toISOString(), recipeCommit, evidenceCommit, sealSha256: digest(sealBytes), sealCount: 216, files, namespace, index: git(['diff', '--cached', '--name-status']).toString(), trackedStatus: git(['status', '--short', '--untracked-files=no']).toString(), ownStatus: git(['status', '--short', '--', path.relative(repository, own)]).toString() };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!['BEFORE.json', 'AFTER.json'].includes(name)) throw Error('OUTPUT_NAME');
  const result = snapshot();
  fs.writeFileSync(path.join(own, name), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output: name, authenticated: result.files.length, sealCount: result.sealCount }));
}
