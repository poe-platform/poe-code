import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const binding = Object.freeze({ scopeSha256: 'ed7d15f4026bb81df52362956939236c7c5f04fb7285f6acc5f9e5ba803d84f3', projectionSha256: 'b290d820b6dcdd2cc406bd27b5b980c873f9ec2cd8a0ad3f66d630012ed50380', candidate: 'c0adae539c736db0e4023d401562ce958d9ebb00', baseCommit: '5137a74ec855a32d8a8860eb66b62eb44d11e290', baseTree: '48e5ae39ce98e1c8e416bae77da40d88b75e1db5', composition: '30f88590b66b88dc9694a56c85f1ee690f02218b', selectedCount: 269, reads: 282 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const modes = new Map([['40000','tree'],['100644','blob'],['100755','blob'],['120000','blob'],['160000','commit']]);
const order = (left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : '')));
function nameCheck(name) {
  assert.equal(typeof name, 'string'); assert.ok(name.length > 0 && Buffer.byteLength(name) <= 1024);
  assert.ok(!name.includes('/') && !name.includes('\0') && name !== '.' && name !== '..');
  assert.equal(Buffer.from(name).toString('utf8'), name, 'exact UTF8 name');
}
export function treeHash(entries) {
  assert.ok(Array.isArray(entries) && entries.length <= 10000);
  const names = new Set();
  for (const entry of entries) {
    assert.deepEqual(Reflect.ownKeys(entry), ['name','mode','hash']);
    for (const key of Reflect.ownKeys(entry)) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(entry, key), 'value'));
    nameCheck(entry.name); assert.ok(!names.has(entry.name), 'duplicate tree name'); names.add(entry.name);
    assert.ok(modes.has(entry.mode), 'canonical Git mode'); assert.match(entry.hash, /^[a-f0-9]{40}$/u);
  }
  const chunks = [...entries].sort(order).map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.hash, 'hex')]));
  const body = Buffer.concat(chunks); assert.ok(body.length <= 2097152);
  return objectHash('tree', body);
}
function parse(bytes) {
  assert.ok(Buffer.isBuffer(bytes)); assert.ok(bytes.length <= 2097152);
  assert.equal(Buffer.from(bytes.toString('utf8')).equals(bytes), true, 'metadata UTF8 roundtrip');
  if (!bytes.length) return [];
  const records = bytes.toString('utf8').split('\0'); assert.equal(records.pop(), '', 'terminal metadata NUL'); assert.ok(records.length <= 10000);
  const seen = new Set();
  return records.map(record => {
    const match = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40})\t([^\0]+)$/u.exec(record); assert.ok(match, 'exact ls-tree record');
    const mode = match[1] === '040000' ? '40000' : match[1], type = match[2], hash = match[3], filename = match[4];
    assert.equal(modes.get(mode), type, 'Git mode/type agreement'); assert.ok(filename.length <= 2048 && filename.split('/').length <= 32);
    for (const part of filename.split('/')) nameCheck(part);
    assert.ok(!seen.has(filename), 'duplicate metadata path'); seen.add(filename);
    return { path: filename, mode, hash };
  });
}
const parent = filename => filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/')) : '';
const basename = filename => filename.slice(filename.lastIndexOf('/') + 1);
function grouped(rows) {
  const groups = new Map();
  for (const row of rows) {
    const directory = parent(row.path); if (!groups.has(directory)) groups.set(directory, []);
    groups.get(directory).push({ name: basename(row.path), mode: row.mode, hash: row.hash });
  }
  for (const entries of groups.values()) assert.deepEqual(entries, [...entries].sort(order), 'canonical metadata order');
  return groups;
}
function baseDirectories(rootBytes, srcBytes, checkpoint) {
  const root = parse(rootBytes); assert.ok(root.every(row => !row.path.includes('/')));
  const rootGroups = grouped(root); assert.equal(rootGroups.size, 1);
  assert.equal(treeHash(rootGroups.get('')), binding.baseTree, 'authenticated base root serialization');
  const src = parse(srcBytes); assert.ok(src.length > 1 && src.every(row => row.path === 'src' || row.path.startsWith('src/')));
  const srcRoot = src.find(row => row.path === 'src'), rootSrc = root.find(row => row.path === 'src');
  assert.ok(srcRoot && rootSrc); assert.equal(srcRoot.mode, '40000'); assert.equal(srcRoot.hash, rootSrc.hash);
  const srcGroups = grouped(src), flattened = [], stack = [{ directory: '', offset: 0 }];
  while (stack.length) {
    checkpoint(); const frame = stack.at(-1), entries = srcGroups.get(frame.directory) ?? [];
    if (frame.offset >= entries.length) { stack.pop(); continue; }
    const entry = entries[frame.offset++], filename = frame.directory ? `${frame.directory}/${entry.name}` : entry.name;
    flattened.push({ path: filename, mode: entry.mode, hash: entry.hash });
    if (entry.mode === '40000') stack.push({ directory: filename, offset: 0 });
  }
  assert.deepEqual(flattened, src, 'canonical recursive metadata order and parent closure');
  for (const row of src.filter(row => row.mode === '40000')) { checkpoint(); assert.equal(treeHash(srcGroups.get(row.path) ?? []), row.hash, `authenticated subtree ${row.path}`); }
  srcGroups.delete('');
  return { groups: new Map([...rootGroups, ...srcGroups]), root, src };
}
export async function admitSelectedSource(scopeBytes, readGit, checkpoint = () => {}) {
  assert.ok(Buffer.isBuffer(scopeBytes)); assert.equal(sha256(scopeBytes), binding.scopeSha256, 'fixed manifest byte binding');
  assert.equal(typeof readGit, 'function'); assert.equal(typeof checkpoint, 'function'); checkpoint();
  const scope = JSON.parse(scopeBytes), selected = scope.selectedSource;
  assert.equal(scope.product, binding.candidate); assert.equal(scope.selectedComposition, binding.composition);
  assert.equal(selected.length, binding.selectedCount); assert.equal(sha256(Buffer.from(JSON.stringify(selected))), binding.projectionSha256);
  const byCommit = new Map(), paths = new Set();
  for (const entry of selected) {
    assert.match(entry.commit, /^[a-f0-9]{40}$/u); assert.match(entry.blob, /^[a-f0-9]{40}$/u); assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(['100644','100755'].includes(entry.mode)); assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 16777216);
    assert.ok(!paths.has(entry.path)); paths.add(entry.path);
    for (const name of entry.path.split('/')) { nameCheck(name); assert.notEqual(name, 'AGENTS.md', 'instruction body never selected'); }
    assert.ok(entry.path.startsWith('src/') || !entry.path.includes('/'), 'selected source/root projection only');
    if (!byCommit.has(entry.commit)) byCommit.set(entry.commit, []); byCommit.get(entry.commit).push(entry);
  }
  assert.equal(byCommit.size, 5); assert.ok(byCommit.has(binding.candidate) && byCommit.has(binding.baseCommit));
  let reads = 0, totalBytes = 0;
  const read = async args => { checkpoint(); assert.ok(++reads <= binding.reads); const bytes = await readGit(args); assert.ok(Buffer.isBuffer(bytes)); totalBytes += bytes.length; assert.ok(totalBytes <= 33554432); checkpoint(); return bytes; };
  for (const commit of byCommit.keys()) {
    const bytes = await read(['cat-file','commit',commit]); assert.ok(bytes.length <= 2097152);
    assert.equal(objectHash('commit', bytes), commit, 'stored source commit object identity');
    const tree = /^tree ([a-f0-9]{40})\n/u.exec(bytes.toString()); assert.ok(tree, 'stored commit tree header');
    if (commit === binding.baseCommit) assert.equal(tree[1], binding.baseTree);
  }
  assert.equal((await read(['rev-parse',`${binding.baseCommit}^{tree}`])).toString(), `${binding.baseTree}\n`, 'stored base reference');
  const rootBytes = await read(['ls-tree','-z',binding.baseTree]);
  const srcBytes = await read(['ls-tree','-r','-t','-z',binding.baseTree,'--','src']);
  const { groups, root, src } = baseDirectories(rootBytes, srcBytes, checkpoint);
  for (const [commit, entries] of byCommit) {
    const sorted = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    const rows = parse(await read(['ls-tree','-r','-z','--full-tree',commit,'--',...sorted.map(entry => entry.path)]));
    assert.deepEqual(rows, sorted.map(entry => ({ path: entry.path, mode: entry.mode, hash: entry.blob })), 'stored source path/mode/blob binding');
  }
  const files = new Map(); let sourceBytes = 0;
  for (const entry of selected) {
    const bytes = await read(['cat-file','blob',entry.blob]);
    assert.ok(bytes.length === entry.bytes && sha256(bytes) === entry.sha256 && objectHash('blob', bytes) === entry.blob, 'actual source blob validation');
    sourceBytes += bytes.length; assert.ok(sourceBytes <= 16777216); files.set(entry.path, { bytes, mode: parseInt(entry.mode, 8) & 0o777 });
    const parts = entry.path.split('/'); let directory = '';
    for (const part of parts.slice(0, -1)) {
      const entries = groups.get(directory); assert.ok(entries); let existing = entries.find(row => row.name === part);
      if (!existing) { existing = { name: part, mode: '40000', hash: '0'.repeat(40) }; entries.push(existing); }
      assert.equal(existing.mode, '40000', 'no file/directory collision');
      directory = directory ? `${directory}/${part}` : part; if (!groups.has(directory)) groups.set(directory, []);
    }
    const entries = groups.get(directory); assert.ok(entries); const name = parts.at(-1), index = entries.findIndex(row => row.name === name);
    if (index !== -1) assert.notEqual(entries[index].mode, '40000', 'no directory/file collision');
    const item = { name, mode: entry.mode, hash: entry.blob }; if (index === -1) entries.push(item); else entries[index] = item;
  }
  const directories = [...groups.keys()].sort((left, right) => right.split('/').length - left.split('/').length || right.length - left.length);
  let composed;
  for (const directory of directories) {
    checkpoint(); const hash = treeHash(groups.get(directory));
    if (!directory) { composed = hash; continue; }
    const entries = groups.get(parent(directory)); assert.ok(entries); const target = entries.find(row => row.name === basename(directory)); assert.ok(target && target.mode === '40000'); target.hash = hash;
  }
  assert.equal(composed, binding.composition, 'derived composition identity'); assert.equal(reads, binding.reads); checkpoint();
  return { files, evidence: { storedCandidateCommit: binding.candidate, storedSourceCommits: [...byCommit.keys()], storedBaseCommit: binding.baseCommit, storedBaseTree: binding.baseTree, derivedComposition: composed, derivedObjectDatabasePresenceRequired: false, selectedInputs: files.size, sourceBytes, gitReads: reads, capturedBytes: totalBytes, directoriesHashed: groups.size, opaqueInstructionEntries: [...root, ...src].filter(row => basename(row.path) === 'AGENTS.md').map(row => ({ path: row.path, mode: row.mode, blob: row.hash, contentRead: false })), opaqueRootTrees: root.filter(row => row.mode === '40000' && row.path !== 'src') } };
}
