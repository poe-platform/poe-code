import fs from 'node:fs/promises';
import path from 'node:path';
import { demand, under, regular, inventory, guard, writeExclusive } from './primitives.mjs';

export async function materializeFiles(root, rows, read, budget) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  for (const row of rows) {
    budget.reserveWork(row.bytes);
    const bytes = await read(row);
    demand(bytes.length === row.bytes, 'MATERIALIZE_BYTES');
    await writeExclusive(under(root, row.path), bytes, row.mode);
    await regular(under(root, row.path), row);
  }
  return inventory(root);
}
export async function admitTools(map, destination, budget) {
  for (const binary of map.binaries) {
    demand(await fs.realpath(binary.origin) === binary.realpath && binary.realpath === binary.origin, 'TOOL_SOURCE_REALPATH');
    budget.reserveWork(binary.bytes);
    const row = await regular(binary.origin, binary);
    const target = under(destination, binary.destination);
    await writeExclusive(target, row.body, row.mode);
    await regular(target, binary);
    await regular(binary.origin, binary);
  }
  for (const tree of map.trees) {
    demand(await fs.realpath(tree.origin) === tree.realpath && tree.realpath === tree.origin, 'TOOL_TREE_REALPATH');
    demand(((await fs.lstat(tree.origin)).mode & 0o777) === tree.rootMode, 'TOOL_ROOT_MODE');
    await guard(tree.origin, tree.sourceRows, { links: true, rootMode: tree.rootMode });
    const target = under(destination, tree.destination);
    await fs.mkdir(target, { recursive: true, mode: tree.rootMode });
    await fs.chmod(target, tree.rootMode);
    for (const row of tree.sourceRows) {
      if (row.kind === 'symlink') continue;
      if (row.kind === 'directory') {
        await fs.mkdir(under(target, row.path), { mode: row.mode });
        await fs.chmod(under(target, row.path), row.mode);
      }
      else {
        budget.reserveWork(row.bytes);
        const source = await regular(under(tree.origin, row.path), row);
        await writeExclusive(under(target, row.path), source.body, row.mode);
      }
    }
    await guard(target, tree.sourceRows.filter(row => row.kind !== 'symlink'), { rootMode: tree.rootMode });
    await guard(tree.origin, tree.sourceRows, { links: true, rootMode: tree.rootMode });
  }
  return inventory(path.join(destination, 'tools'));
}
export async function authenticateToolOrigins(map) {
  for (const binary of map.binaries) await regular(binary.origin, binary);
  for (const tree of map.trees) await guard(tree.origin, tree.sourceRows, { links: true, rootMode: tree.rootMode });
}
export function selectedFileMap(rows) {
  return rows.filter(row => row.kind === 'file').map(({ path: name, mode, bytes, sha256 }) => ({ path: name, mode, bytes, sha256 })).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}
export async function packageGuard(root, expected) {
  const rows = await inventory(root);
  demand(JSON.stringify(selectedFileMap(rows)) === JSON.stringify(expected), 'FULL_PACKAGE_FILES');
  const neededDirectories = new Set();
  for (const row of expected) {
    let directory = path.posix.dirname(row.path);
    while (directory !== '.') { neededDirectories.add(directory); directory = path.posix.dirname(directory); }
  }
  demand(rows.filter(row => row.kind === 'directory').length === neededDirectories.size && rows.every(row => row.kind === 'file' || neededDirectories.has(row.path)), 'FULL_PACKAGE_ADDED_DIRECTORY');
  return rows;
}
export async function movedGuard(original, moved, expected) {
  demand(await fs.lstat(original).then(() => false, error => error.code === 'ENOENT'), 'MOVE_OLD_ABSENCE');
  return packageGuard(moved, expected);
}
