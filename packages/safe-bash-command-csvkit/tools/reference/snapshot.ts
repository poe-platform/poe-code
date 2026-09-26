import path from 'node:path';
import { createHash } from 'node:crypto';

interface SnapshotFileSystem {
  lstat(path: string): Promise<{ size: number; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export async function snapshot(root: string, fs: SnapshotFileSystem, maxBytes: number) {
  const entries: { path: string; kind: string; bytesBase64?: string; sha256?: string }[] = [];
  let admitted = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const name of (await fs.readdir(directory)).sort()) {
      const target = path.join(directory, name);
      const relative = path.relative(root, target).split(path.sep).join('/');
      const stat = await fs.lstat(target);
      if (entries.length >= 10_000) throw new Error('snapshot entry cap exceeded');
      if (stat.isSymbolicLink()) throw new Error(`unqualified symlink effect: ${relative}`);
      if (stat.isDirectory()) { entries.push({ path: relative, kind: 'directory' }); await walk(target); }
      else if (stat.isFile()) {
        if (stat.size > maxBytes - admitted) throw new Error('snapshot byte cap exceeded');
        admitted += stat.size;
        const bytes = await fs.readFile(target);
        if (bytes.byteLength !== stat.size) throw new Error(`unstable snapshot: ${relative}`);
        entries.push({ path: relative, kind: 'file', bytesBase64: Buffer.from(bytes).toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw new Error(`unqualified special-file effect: ${relative}`);
    }
  };
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('snapshot root must be a nonlink directory');
  await walk(root);
  return entries;
}
