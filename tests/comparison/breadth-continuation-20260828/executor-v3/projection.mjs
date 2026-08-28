import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { hash, requireThat, relativeName } from './safety.mjs';

export function boundFile(filename, expected, metadataOnly = false) {
  const info = fs.lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink(), 'FILE_TYPE', filename);
  requireThat(info.size === expected.bytes && (expected.mode === undefined || (info.mode & 0o7777) === expected.mode), 'FILE_METADATA', filename);
  if (metadataOnly) return null;
  const bytes = fs.readFileSync(filename);
  requireThat(hash(bytes) === expected.sha256, 'FILE_HASH', filename);
  return bytes;
}
export function directories(files) {
  const result = new Set();
  for (const file of files) {
    let parent = path.posix.dirname(file.path);
    while (parent !== '.') { result.add(parent); parent = path.posix.dirname(parent); }
  }
  return [...result].sort();
}
export function inspectTree(root, files, excluded = [], directoryMode = 0o755) {
  requireThat(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), 'ROOT_TYPE', root);
  const expected = new Map(files.map(file => [file.path, file]));
  const omissions = new Map(excluded.map(file => [file.path, file]));
  const allowedDirectories = new Set(directories([...files, ...excluded]));
  const seen = new Set();
  let total = 0;
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const filename = relative ? `${relative}/${name}` : name;
      requireThat(expected.has(filename) || omissions.has(filename) || allowedDirectories.has(filename), 'UNLISTED_ENTRY', filename);
      requireThat(++total <= files.length + excluded.length + allowedDirectories.size, 'TREE_COUNT', filename);
      const absolute = path.join(root, filename);
      const info = fs.lstatSync(absolute);
      requireThat(!info.isSymbolicLink(), 'SYMLINK', filename);
      if (allowedDirectories.has(filename)) {
        requireThat(info.isDirectory() && (directoryMode === null || (info.mode & 0o7777) === directoryMode), 'DIRECTORY_MODE', filename);
        visit(filename);
      } else {
        boundFile(absolute, expected.get(filename) ?? omissions.get(filename), omissions.has(filename));
        seen.add(filename);
      }
    }
  }
  visit('');
  requireThat(seen.size === files.length + excluded.length, 'MISSING_ENTRY', { expected: files.length + excluded.length, actual: seen.size });
  return { files: files.length, omittedMetadataOnly: excluded.length, entries: total, complete: true };
}
export function tarMembers(compressed, expected) {
  const archive = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  const found = new Map();
  let offset = 0;
  let ended = false;
  const text = bytes => bytes.toString('utf8').replace(/\0.*$/s, '');
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512); offset += 512;
    if (header.every(value => value === 0)) { ended = true; break; }
    const claimed = Number.parseInt(text(header.subarray(148, 156)).trim(), 8);
    const sum = header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0);
    requireThat(sum === claimed, 'TAR_HEADER', offset);
    const prefix = text(header.subarray(345, 500));
    const name = `${prefix ? `${prefix}/` : ''}${text(header.subarray(0, 100))}`;
    const size = Number.parseInt(text(header.subarray(124, 136)).trim(), 8);
    const mode = Number.parseInt(text(header.subarray(100, 108)).trim(), 8);
    requireThat(Number.isSafeInteger(size) && size >= 0 && offset + size <= archive.length, 'TAR_SIZE', name);
    requireThat(header[156] === 48 || header[156] === 0, 'TAR_UNSUPPORTED_TYPE', { name, type: header[156] });
    requireThat(name.startsWith('package/'), 'TAR_PREFIX', name);
    const relative = relativeName(name.slice(8));
    const entry = expected.find(file => file.path === relative);
    requireThat(entry && !found.has(relative), 'TAR_MEMBERSHIP', relative);
    const bytes = archive.subarray(offset, offset + size);
    requireThat(entry.bytes === size && entry.mode === mode && hash(bytes) === entry.sha256, 'TAR_FILE', relative);
    found.set(relative, bytes);
    offset += Math.ceil(size / 512) * 512;
  }
  requireThat(ended && archive.subarray(offset).every(value => value === 0) && found.size === expected.length, 'TAR_COMPLETE', found.size);
  return found;
}
export function writeView(root, entries, content) {
  fs.mkdirSync(root, { recursive: true, mode: 0o755 });
  for (const name of directories(entries)) fs.mkdirSync(path.join(root, name), { recursive: true, mode: 0o755 });
  for (const entry of entries) {
    relativeName(entry.path);
    const bytes = content(entry);
    requireThat(bytes.length === entry.bytes && hash(bytes) === entry.sha256, 'WRITE_BINDING', entry.path);
    fs.writeFileSync(path.join(root, entry.path), bytes, { flag: 'wx', mode: entry.mode });
    fs.chmodSync(path.join(root, entry.path), entry.mode);
  }
  return inspectTree(root, entries);
}
export function viewProjection(projection, name) {
  requireThat(['target-installed', 'target-moved', 'baseline-installed'].includes(name), 'VIEW_NAME', name);
  const baseline = name === 'baseline-installed';
  const consumerPath = baseline ? 'benchmarks/consumer.mjs' : 'consumer.mjs';
  const consumer = `import * as library from '${baseline ? 'just-bash' : 'virtual-bash'}';\nexport { library };\n`;
  const files = baseline ? projection.baseline.closure.files.filter(entry => !projection.baseline.excluded.some(omit => omit.path === entry.path)) : projection.target.files.map(entry => ({ ...entry, path: `node_modules/virtual-bash/${entry.path}` }));
  return { engine: baseline ? 'just-bash' : 'virtual-bash', consumerPath, consumer, files: [...files, { path: consumerPath, bytes: Buffer.byteLength(consumer), sha256: hash(consumer), mode: 0o644 }] };
}
export function authenticateView(projection, view) {
  const expected = viewProjection(projection, view.name);
  requireThat(view.engine === expected.engine && view.consumerPath === expected.consumerPath && JSON.stringify(view.files) === JSON.stringify(expected.files), 'VIEW_PROJECTION_BINDING', view.name);
  requireThat(path.isAbsolute(view.root) && path.basename(view.root) === view.name, 'VIEW_ROOT', view.root);
  requireThat(view.oldOrigin === (view.name === 'target-moved' ? path.join(path.dirname(view.root), 'move-origin') : null), 'MOVE_ORIGIN_BINDING', view.oldOrigin);
  return true;
}
export function parseStage(bytes, expectedSha256) {
  requireThat(bytes.length <= 2 * 1024 * 1024 && hash(bytes) === expectedSha256, 'STAGED_HASH', expectedSha256);
  return JSON.parse(bytes);
}
export function stage(work, projection) {
  const targetMembers = tarMembers(boundFile(projection.target.pack.physical, projection.target.pack), projection.target.files);
  boundFile(projection.baseline.archive.physical, projection.baseline.archive);
  const excluded = projection.baseline.excluded;
  const baselineFiles = projection.baseline.closure.files.filter(entry => !excluded.some(omit => omit.path === entry.path));
  const before = inspectTree(projection.baseline.closure.root, baselineFiles, excluded, null);
  const views = {};
  for (const name of ['target-installed', 'target-moved', 'baseline-installed']) {
    const baseline = name === 'baseline-installed';
    const origin = path.join(work, name === 'target-moved' ? 'move-origin' : name);
    const root = path.join(work, name);
    const consumerPath = baseline ? 'benchmarks/consumer.mjs' : 'consumer.mjs';
    const text = `import * as library from '${baseline ? 'just-bash' : 'virtual-bash'}';\nexport { library };\n`;
    const files = baseline ? baselineFiles : projection.target.files.map(entry => ({ ...entry, path: `node_modules/virtual-bash/${entry.path}` }));
    const entries = [...files, { path: consumerPath, bytes: Buffer.byteLength(text), sha256: hash(text), mode: 0o644 }];
    writeView(origin, entries, entry => entry.path === consumerPath ? Buffer.from(text) : baseline ? boundFile(path.join(projection.baseline.closure.root, entry.path), entry) : targetMembers.get(entry.path.slice('node_modules/virtual-bash/'.length)));
    if (name === 'target-moved') fs.renameSync(origin, root);
    views[name] = { name, root, files: entries, consumerPath, engine: baseline ? 'just-bash' : 'virtual-bash', oldOrigin: name === 'target-moved' ? origin : null };
  }
  const after = inspectTree(projection.baseline.closure.root, baselineFiles, excluded, null);
  boundFile(projection.target.pack.physical, projection.target.pack);
  boundFile(projection.baseline.archive.physical, projection.baseline.archive);
  return { views, before, after, proof: 'exact accepted target pack reuse plus declared comparator projection, not rebuild/full-history proof' };
}
