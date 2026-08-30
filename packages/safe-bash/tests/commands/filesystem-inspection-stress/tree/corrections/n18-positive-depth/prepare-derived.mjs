import { constants } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const derived = join(directory, 'derived');
await mkdir(derived, { recursive: true });
for (const name of ['run.mjs', 'corpus.mjs', 'fixture-fs.mjs', 'native.json']) {
  await copyFile(join('/tmp/safe-bash-tree-hidden-prep-vyzfHc', name), join(derived, name), constants.COPYFILE_EXCL);
}
for (const name of ['bridge.mjs', 'profile.json']) {
  await copyFile(join('/tmp/safe-bash-tree-initial-run-NN3E3X', name), join(directory, name), constants.COPYFILE_EXCL);
}
