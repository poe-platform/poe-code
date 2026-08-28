import { posix } from 'node:path';
import { hash, requireThat } from '../executor-preparation-v1/core.mjs';

export const workflowOwned = filename => filename === '/fixture' || filename.startsWith('/fixture/');
export function stableEntry(entry) {
  const result = { path: entry.path, type: entry.type, mode: entry.mode & 0o7777 };
  if (entry.type === 'file') {
    result.size = entry.size;
    result.sha256 = entry.sha256 ?? hash(Buffer.from(entry.base64, 'base64'));
  }
  if (entry.type === 'symlink') result.target = entry.target;
  return result;
}
export function assessNamespace(entries, profile) {
  const expected = new Map(profile.scaffolding.map(entry => [entry.path, entry]));
  const outside = entries.filter(entry => !workflowOwned(entry.path));
  const owned = entries.filter(entry => workflowOwned(entry.path));
  requireThat(new Set(entries.map(entry => entry.path)).size === entries.length, 'DUPLICATE_NAMESPACE_PATH', 'census');
  requireThat(owned.length <= profile.maxWorkflowEntries, 'WORKFLOW_ENTRY_CAP', owned.length);
  requireThat(outside.length === expected.size, 'SCAFFOLD_COUNT', outside.length);
  requireThat(entries.length <= profile.maxTotalEntries, 'TOTAL_ENTRY_CAP', entries.length);
  let ownedBytes = 0;
  let scaffoldBytes = 0;
  for (const entry of entries) {
    if (workflowOwned(entry.path)) {
      if (entry.type === 'file') ownedBytes += entry.size;
    } else {
      const bound = expected.get(entry.path);
      requireThat(bound, 'UNLISTED_SCAFFOLD', entry.path);
      requireThat(JSON.stringify(stableEntry(entry)) === JSON.stringify(bound), 'SCAFFOLD_CHANGED', entry.path);
      if (entry.type === 'file') scaffoldBytes += entry.size;
    }
  }
  requireThat(ownedBytes <= profile.maxWorkflowBytes, 'WORKFLOW_BYTE_CAP', ownedBytes);
  requireThat(scaffoldBytes === profile.scaffoldingBytes, 'SCAFFOLD_BYTES', scaffoldBytes);
  requireThat(ownedBytes + scaffoldBytes <= profile.maxTotalReadBytes, 'TOTAL_READ_CAP', ownedBytes + scaffoldBytes);
  return { workflowEntries: owned.length, scaffoldEntries: outside.length, workflowBytes: ownedBytes, scaffoldBytes, completeScaffolding: true };
}
export async function census(filesystem, engine, profile, signal) {
  const expected = new Map(profile.scaffolding.map(entry => [entry.path, entry]));
  const result = { complete: false, entries: [], bytes: 0, errors: [] };
  let workflowEntries = 0;
  let workflowBytes = 0;
  let scaffoldingBytes = 0;
  const visit = async (filename, depth) => {
    requireThat(depth <= 32 && result.entries.length < profile.maxTotalEntries, 'CENSUS_BOUND', filename);
    requireThat(!filename.split('/').some(name => name.toUpperCase() === 'AGENTS.MD'), 'INSTRUCTION_FILE_FORBIDDEN', filename);
    const owned = workflowOwned(filename);
    const bound = expected.get(filename);
    requireThat(owned || bound, 'UNLISTED_SCAFFOLD', filename);
    if (owned) { workflowEntries++; requireThat(workflowEntries <= profile.maxWorkflowEntries, 'WORKFLOW_ENTRY_CAP', workflowEntries); }
    const stat = await filesystem.lstat(filename);
    const type = engine === 'virtual-bash' ? stat.type : stat.isSymbolicLink ? 'symlink' : stat.isDirectory ? 'directory' : stat.isFile ? 'file' : 'unknown';
    requireThat(['file', 'directory', 'symlink'].includes(type), 'CENSUS_TYPE', filename);
    const entry = { path: filename, type, mode: stat.mode, size: stat.size };
    result.entries.push(entry);
    if (type === 'file') {
      requireThat(Number.isSafeInteger(stat.size) && stat.size >= 0, 'CENSUS_SIZE', filename);
      if (owned) workflowBytes += stat.size;
      else { requireThat(bound.type === 'file' && stat.size === bound.size, 'SCAFFOLD_SIZE', filename); scaffoldingBytes += stat.size; }
      requireThat(workflowBytes <= profile.maxWorkflowBytes && scaffoldingBytes <= profile.scaffoldingBytes && workflowBytes + scaffoldingBytes <= profile.maxTotalReadBytes, 'CENSUS_BYTE_BOUND', filename);
      const bytes = engine === 'virtual-bash'
        ? await filesystem.readFile(filename, { signal, maxBytes: stat.size })
        : await filesystem.readFileBuffer(filename);
      requireThat(bytes.length === stat.size, 'CENSUS_READ_SIZE', filename);
      entry.sha256 = hash(bytes);
      if (owned) entry.base64 = Buffer.from(bytes).toString('base64');
      result.bytes += bytes.length;
    } else if (type === 'symlink') entry.target = await filesystem.readlink(filename);
    if (!owned) requireThat(JSON.stringify(stableEntry(entry)) === JSON.stringify(bound), 'SCAFFOLD_CHANGED', filename);
    if (type === 'directory') {
      const children = await filesystem.readdir(filename);
      requireThat(Array.isArray(children) && children.length <= profile.maxTotalEntries, 'READDIR_BOUND', filename);
      const names = children.map(child => typeof child === 'string' ? child : child.name).sort();
      requireThat(new Set(names).size === names.length, 'DUPLICATE_NAMESPACE_PATH', filename);
      for (const name of names) {
        requireThat(typeof name === 'string' && name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0'), 'BAD_NAMESPACE_NAME', filename);
        await visit(posix.join(filename, name), depth + 1);
      }
    }
  };
  await visit('/', 0);
  result.bounds = assessNamespace(result.entries, profile);
  result.complete = true;
  requireThat(Buffer.byteLength(JSON.stringify(result)) <= profile.maxSnapshotMetadataBytes, 'SNAPSHOT_METADATA_CAP', profile.maxSnapshotMetadataBytes);
  return result;
}
