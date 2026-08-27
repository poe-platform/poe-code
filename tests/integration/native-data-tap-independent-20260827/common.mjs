import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const owned = fileURLToPath(new URL('./', import.meta.url));
export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const policy = JSON.parse(readFileSync(join(owned, 'policy.json')));
export const fixture = 'tests/plugins/qualified-current-release-native-data/controls.test.ts';
export const prefix = 'tests/plugins/qualified-current-release-native-data';
export const node22 = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
export const node24 = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
export const npmRoot = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm';
export const npmCli = join(npmRoot, 'bin/npm-cli.js');
export const tooling = join(repository, 'node_modules');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
export const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export const selected = [fixture, `${prefix}/helpers.ts`, `${prefix}/before-02.json`, `${prefix}/classification.json`,
  'package.json', 'tsconfig.json', 'tests/plugins/qualified-current-release/consumers.mjs',
  'tests/plugins/qualified-current-release/captured-types.json', 'tests/plugins/qualified-current-release/staged-types.json',
  'tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts',
  'tests/integration/adapter-tools/atomic-webdav-profile/controls.ts',
  'tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts',
  'tests/shell-stress/env-split-consumer/packed-public-types.ts', 'package-lock.json'].sort();

export function inventory(root) {
  const entries = [];
  function walk(directory) {
    for (const name of readdirSync(join(root, directory)).sort()) {
      const path = directory ? `${directory}/${name}` : name;
      const absolute = join(root, path), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) entries.push({ path, kind: 'link', target: readlinkSync(absolute), realpath: realpathSync(absolute) });
      else if (stat.isDirectory()) { entries.push({ path, kind: 'directory' }); walk(path); }
      else { assert.ok(stat.isFile(), path); entries.push({ path, kind: 'file', bytes: stat.size, sha256: digest(readFileSync(absolute)) }); }
    }
  }
  walk('');
  return entries;
}

export function toolIdentity(path) {
  return { path, realpath: realpathSync(path), bytes: lstatSync(realpathSync(path)).size, sha256: digest(readFileSync(path)) };
}

export function version(path, args = ['--version']) {
  return execFileSync(path, args, { env: { PATH: '/usr/bin:/bin', HOME: '/tmp' }, timeout: 15000, maxBuffer: 1048576 }).toString().trim();
}
