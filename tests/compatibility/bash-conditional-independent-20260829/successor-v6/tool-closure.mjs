import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hashRegularFile } from './hash-regular-file.mjs';
export async function verifyToolClosure(inventory) {
  for (const tool of Object.values(inventory.tools)) {
    const seen = [], root = await fs.realpath(tool.origin);
    assert.equal(root, tool.origin);
    async function visit(relative) {
      for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
        const member = path.join(relative, name), filename = path.join(root, member), stat = await fs.lstat(filename);
        if (stat.isSymbolicLink()) {
          const target = await fs.realpath(filename); assert.ok(target.startsWith(root + path.sep));
          seen.push({ path: member, kind: 'link', mode: stat.mode & 511, text: await fs.readlink(filename), target: path.relative(root, target), targetHash: hashRegularFile(target).sha256 });
        } else if (stat.isDirectory()) await visit(member);
        else { assert.ok(stat.isFile()); seen.push({ path: member, kind: 'file', bytes: stat.size, mode: stat.mode & 511, sha256: hashRegularFile(filename).sha256 }); }
      }
    }
    await visit(''); seen.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    assert.deepEqual(seen, tool.rows, 'complete tool closure drift');
  }
}
