import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { builtinModules, registerHooks } from 'node:module';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const preparationRoot = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(preparationRoot, '../../../../..');
const authorized = new WeakSet();
const candidates = new WeakSet();
const materialized = new WeakMap();
let importScopeActive = false;
const builtins = new Set(builtinModules.map(name => name.startsWith('node:') ? name : `node:${name}`));

export function requireFact(condition, code, detail = '') {
  if (!condition) throw Object.assign(new Error(`${code}: ${detail}`), { code });
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value !== null && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));
  return JSON.stringify(value);
}

export function within(root, path) {
  const suffix = relative(root, path);
  return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix));
}

export function safePath(path) {
  requireFact(typeof path === 'string' && path.length > 0 && path.length <= 1024 && !path.includes('\\') && !path.includes('\0') && !isAbsolute(path), 'PATH', String(path));
  requireFact(path.split('/').every(part => /^[A-Za-z0-9_.-]+$/u.test(part) && !['.', '..', '__proto__', 'constructor', 'prototype', 'node_modules'].includes(part)), 'PATH', path);
  return path;
}

export function regularRoot(path) {
  const absolute = resolve(path);
  let current = absolute;
  while (true) {
    requireFact(!lstatSync(current).isSymbolicLink(), 'SYMLINK', current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  requireFact(lstatSync(absolute).isDirectory() && realpathSync(absolute) === absolute, 'ROOT', absolute);
  return absolute;
}

export function inspectTree(root) {
  root = regularRoot(root);
  const files = {};
  const directories = { '': lstatSync(root).mode & 4095 };
  let totalBytes = 0;
  let entries = 0;
  const visit = path => {
    for (const name of readdirSync(join(root, path)).sort()) {
      const child = safePath(path ? `${path}/${name}` : name);
      const full = join(root, child);
      const stat = lstatSync(full);
      requireFact(++entries <= 4096, 'TREE_LIMIT');
      requireFact(!stat.isSymbolicLink(), 'SYMLINK', child);
      if (stat.isDirectory()) {
        directories[child] = stat.mode & 4095;
        visit(child);
      } else {
        requireFact(stat.isFile(), 'REGULAR_FILE', child);
        requireFact(stat.nlink === 1, 'HARDLINK', child);
        totalBytes += stat.size;
        requireFact(stat.size <= 16 * 1024 * 1024 && totalBytes <= 64 * 1024 * 1024, 'TREE_LIMIT');
        const bytes = readFileSync(full);
        const after = lstatSync(full);
        requireFact(after.isFile() && !after.isSymbolicLink() && after.nlink === 1 && after.ino === stat.ino && after.dev === stat.dev && after.mtimeMs === stat.mtimeMs && after.mode === stat.mode && bytes.length === stat.size, 'TREE_CHANGED', child);
        files[child] = { sha256: sha256(bytes), bytes: bytes.length, mode: stat.mode & 4095 };
      }
    }
  };
  visit('');
  return { files, directories };
}

function descriptor(value) {
  requireFact(value && Object.keys(value).sort().join(',') === 'bytes,mode,sha256' && /^[a-f0-9]{64}$/u.test(value.sha256) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.mode === 420, 'DESCRIPTOR');
}

export function assertPackageTree(root, expected) {
  const actual = inspectTree(root);
  requireFact(canonical(Object.keys(actual.files).sort()) === canonical(Object.keys(expected.files).sort()), 'PACKAGE_MEMBERSHIP');
  requireFact(canonical(actual.directories) === canonical(expected.directories), 'PACKAGE_DIRECTORIES');
  for (const [path, identity] of Object.entries(expected.files)) requireFact(canonical(actual.files[path]) === canonical(identity), 'PACKAGE_FILE', path);
  return actual;
}

export function readHashedJson(path, expectedHash) {
  regularRoot(dirname(resolve(path)));
  const stat = lstatSync(path);
  requireFact(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 4 * 1024 * 1024, 'RECEIPT_FILE');
  const bytes = readFileSync(path);
  requireFact(/^[a-f0-9]{64}$/u.test(expectedHash) && sha256(bytes) === expectedHash, 'RECEIPT_HASH');
  const tokens = bytes.toString('utf8').match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu) ?? [];
  const stack = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const key = JSON.parse(token);
      requireFact(stack.at(-1) instanceof Set && !stack.at(-1).has(key), 'JSON_DUPLICATE', key);
      requireFact(!['__proto__', 'constructor', 'prototype'].includes(key), 'RECEIPT_SCHEMA', key);
      stack.at(-1).add(key);
    }
  }
  return JSON.parse(bytes);
}

function readLocal(name) {
  return JSON.parse(readFileSync(join(preparationRoot, name), 'utf8'));
}

export function verifyPreseal() {
  const seal = readLocal('PRESEAL.json');
  for (const [path, hash] of Object.entries(seal.files)) requireFact(sha256(readFileSync(join(preparationRoot, safePath(path)))) === hash, 'PRESEAL_HASH', path);
  return seal;
}

function git(...args) {
  return execFileSync('git', ['-C', workspaceRoot, ...args], { maxBuffer: 32 * 1024 * 1024, env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' } });
}

export function verifySelected() {
  verifyPreseal();
  const selected = readLocal('SELECTED.json');
  for (const source of selected.selected) requireFact(sha256(git('show', `${source.revision}:${source.path}`)) === source.sha256, 'SELECTED_HASH', source.path);
  const reportBinding = selected.selected.find(source => source.path.endsWith('full-package-addendum-v1/result/REPORT.json'));
  const report = JSON.parse(git('show', `${reportBinding.revision}:${reportBinding.path}`));
  requireFact(canonical(report.package.validation.files) === canonical(readLocal('BASELINE-PACKAGE.json')), 'BASELINE_MAP');
  requireFact(report.package.sha256 === selected.fullPackageSha256, 'BASELINE_MAP');
  requireFact(sha256(git('show', `${selected.readme.sourceRevision}:README.md`)) === selected.readme.sha256, 'README_IDENTITY');
  return selected;
}

export function validateReceiptShape(receipt, sourceOnly = false) {
  const keys = ['schema', 'sourceBase', 'acceptedLength', 'candidateCommit', 'sourceAdditions', ...(sourceOnly ? [] : ['packageAdditions', 'packageDirectories', 'entries', 'allowedBuiltins', 'buildReceipt'])];
  requireFact(receipt && canonical(Object.keys(receipt).sort()) === canonical(keys.sort()) && receipt.schema === 1, 'RECEIPT_SCHEMA');
  requireFact(/^[a-f0-9]{40}$/u.test(receipt.candidateCommit), 'RECEIPT_SCHEMA');
  for (const field of ['sourceAdditions', ...(sourceOnly ? [] : ['packageAdditions', 'packageDirectories', 'entries', 'buildReceipt'])]) requireFact(receipt[field] !== null && typeof receipt[field] === 'object' && !Array.isArray(receipt[field]), 'RECEIPT_SCHEMA', field);
  for (const field of ['sourceAdditions', ...(sourceOnly ? [] : ['packageAdditions'])]) for (const [path, value] of Object.entries(receipt[field])) { safePath(path); descriptor(value); }
  requireFact(Object.keys(receipt.sourceAdditions).length > 0, 'RECEIPT_SCHEMA');
  for (const path of Object.keys(receipt.sourceAdditions)) requireFact((path.startsWith('src/commands/yq/') && (path.endsWith('.ts') || path.endsWith('.md')) && !path.endsWith('.d.ts')) || path === 'src/commands/structured/query-core.ts', 'SOURCE_BINDING', path);
  if (sourceOnly) return receipt;
  requireFact(canonical(Object.keys(receipt.entries).sort()) === canonical(['contracts', 'yq']), 'RECEIPT_SCHEMA');
  requireFact(receipt.entries.contracts === 'dist/contracts/index.js' && /^dist\/commands\/yq\/[A-Za-z0-9_./-]+\.js$/u.test(receipt.entries.yq), 'IMPORT_BINDING');
  Object.values(receipt.entries).forEach(safePath);
  requireFact(Array.isArray(receipt.allowedBuiltins) && new Set(receipt.allowedBuiltins).size === receipt.allowedBuiltins.length && receipt.allowedBuiltins.every(name => builtins.has(name)), 'RECEIPT_SCHEMA');
  requireFact(canonical(Object.keys(receipt.buildReceipt).sort()) === canonical(['path', 'sha256']) && isAbsolute(receipt.buildReceipt.path) && /^[a-f0-9]{64}$/u.test(receipt.buildReceipt.sha256), 'RECEIPT_SCHEMA');
  for (const [path, mode] of Object.entries(receipt.packageDirectories)) {
    if (path !== '') safePath(path);
    requireFact(mode === 493, 'RECEIPT_SCHEMA', 'directory modes must be 0755');
  }
  return receipt;
}

export function expectedPackage(receipt, baseline, readmeIdentity) {
  requireFact(canonical(baseline['README.md']) === canonical({ sha256: readmeIdentity.sha256, bytes: readmeIdentity.bytes, mode: readmeIdentity.mode }), 'README_IDENTITY');
  const names = Object.keys(receipt.sourceAdditions).filter(path => path.endsWith('.ts')).flatMap(path => ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => path.replace(/^src\//u, 'dist/').replace(/\.ts$/u, extension))).sort();
  requireFact(canonical(names) === canonical(Object.keys(receipt.packageAdditions).sort()), 'PACKAGE_OUTPUTS');
  for (const path of names) requireFact(!Object.hasOwn(baseline, path), 'PACKAGE_REPLACEMENT', path);
  const files = { ...baseline, ...receipt.packageAdditions };
  for (const path of Object.values(receipt.entries)) requireFact(Object.hasOwn(files, path) && Object.hasOwn(files, path.replace(/\.js$/u, '.d.ts')), 'IMPORT_BINDING', path);
  const directoryNames = new Set(['']);
  for (const path of Object.keys(files)) {
    safePath(path);
    let parent = dirname(path);
    while (parent !== '.') { directoryNames.add(parent); parent = dirname(parent); }
  }
  requireFact(canonical([...directoryNames].sort()) === canonical(Object.keys(receipt.packageDirectories).sort()), 'PACKAGE_DIRECTORIES');
  return { files, directories: receipt.packageDirectories };
}

export function assertSourceMap(actual, expected) {
  requireFact(canonical(actual) === canonical(expected), 'SOURCE_BINDING');
}

export function authorizeSources(receiptPath, receiptHash) {
  const selected = verifySelected();
  const input = readHashedJson(receiptPath, receiptHash);
  const sourceOnly = !Object.hasOwn(input, 'packageAdditions');
  const receipt = validateReceiptShape(input, sourceOnly);
  requireFact(receipt.sourceBase === selected.sourceBase && receipt.acceptedLength === selected.acceptedLength, 'SOURCE_BINDING');
  const baseline = readLocal('SOURCE-BASE.json');
  for (const path of Object.keys(receipt.sourceAdditions)) requireFact(!Object.hasOwn(baseline, path), 'SOURCE_BINDING', path);
  const expected = Object.fromEntries(Object.entries(baseline).map(([path, value]) => [path, { sha256: value.sha256, bytes: value.bytes, mode: value.mode }]));
  Object.assign(expected, receipt.sourceAdditions);
  const actual = {};
  const rows = git('ls-tree', '-r', '-z', receipt.candidateCommit, '--', 'src', 'package.json', 'README.md', 'tsconfig.json', 'tsconfig.build.json').toString().split('\0').filter(Boolean);
  for (const row of rows) {
    const [metadata, path] = row.split('\t');
    const [mode, type, blob] = metadata.split(' ');
    requireFact(mode === '100644' && type === 'blob', 'SOURCE_BINDING', path);
    const bytes = git('cat-file', 'blob', blob);
    actual[path] = { sha256: sha256(bytes), bytes: bytes.length, mode: 420 };
  }
  assertSourceMap(actual, expected);
  const expectedTree = sourceOnly ? null : expectedPackage(receipt, readLocal('BASELINE-PACKAGE.json'), selected.readme);
  const result = Object.freeze({ receiptHash, receipt: deepFreeze(receipt), expected: deepFreeze(expectedTree), sourceFiles: deepFreeze(actual), sourceMapSha256: sha256(canonical(actual)) });
  authorized.add(result);
  return result;
}

export function assertSourceMaterialization(authority, sourceRoot) {
  requireFact(authorized.has(authority), 'SOURCE_BINDING');
  sourceRoot = regularRoot(sourceRoot);
  requireFact(!within(workspaceRoot, sourceRoot), 'WORKSPACE', sourceRoot);
  const directories = { '': 493 };
  for (const path of Object.keys(authority.sourceFiles)) {
    let parent = dirname(path);
    while (parent !== '.') { directories[parent] = 493; parent = dirname(parent); }
  }
  return assertPackageTree(sourceRoot, { files: authority.sourceFiles, directories });
}

export function authorizeCandidate(receiptPath, receiptHash, packageRoot) {
  const authority = authorizeSources(receiptPath, receiptHash);
  requireFact(authority.expected !== null, 'BUILD_BINDING', 'source-only authority cannot admit a compiled candidate');
  requireFact(!within(resolve(packageRoot), resolve(authority.receipt.buildReceipt.path)), 'EVIDENCE_LOCATION');
  const build = readHashedJson(authority.receipt.buildReceipt.path, authority.receipt.buildReceipt.sha256);
  requireFact(build.sourceMapSha256 === authority.sourceMapSha256 && build.packageMapSha256 === sha256(canonical(authority.expected)) && build.candidateCommit === authority.receipt.candidateCommit, 'BUILD_BINDING');
  assertPackageTree(packageRoot, authority.expected);
  candidates.add(authority);
  return authority;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export function assertMoveLocations(original, staging, destination, workspace) {
  requireFact(new Set([resolve(original), resolve(staging), resolve(destination)]).size === 3 && !within(resolve(original), resolve(destination)) && !within(resolve(original), resolve(staging)), 'NOT_MOVED');
  for (const path of [staging, destination]) requireFact(!within(resolve(workspace), resolve(path)), 'WORKSPACE', path);
}

export function copyRegularTree(original, destination, expected) {
  assertPackageTree(original, expected);
  requireFact(!existsSync(destination), 'DESTINATION_EXISTS');
  mkdirSync(destination, { mode: expected.directories[''] });
  for (const path of Object.keys(expected.directories).filter(Boolean).sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) mkdirSync(join(destination, path), { mode: expected.directories[path] });
  for (const [path, identity] of Object.entries(expected.files)) { copyFileSync(join(original, path), join(destination, path)); chmodSync(join(destination, path), identity.mode); }
  for (const [path, mode] of Object.entries(expected.directories)) chmodSync(join(destination, path), mode);
  assertPackageTree(original, expected);
  assertPackageTree(destination, expected);
}

export function materializeCandidate(authority, original, destination) {
  requireFact(candidates.has(authority), 'BINDING');
  const movement = copyAndMoveRegularTree(original, destination, authority.expected, workspaceRoot);
  const binding = Object.freeze({ ...movement, receiptHash: authority.receiptHash });
  materialized.set(binding, authority);
  assertBound(binding);
  return binding;
}

export function copyAndMoveRegularTree(original, destination, expected, workspace) {
  original = regularRoot(original);
  const parent = regularRoot(dirname(destination));
  destination = join(parent, safePath(relative(parent, resolve(destination))));
  requireFact(!within(workspace, destination), 'WORKSPACE');
  requireFact(!existsSync(destination), 'DESTINATION_EXISTS');
  const container = mkdtempSync(join(parent, '.yq-materialization-'));
  const staging = join(container, 'stage');
  assertMoveLocations(original, staging, destination, workspace);
  copyRegularTree(original, staging, expected);
  const before = lstatSync(staging);
  renameSync(staging, destination);
  const after = lstatSync(destination);
  requireFact(!existsSync(staging) && before.ino === after.ino && before.dev === after.dev, 'NOT_MOVED');
  assertPackageTree(original, expected);
  assertPackageTree(destination, expected);
  return Object.freeze({ original, root: destination, staging, directoryIdentity: Object.freeze({ ino: after.ino, dev: after.dev }) });
}

export function assertBound(binding) {
  const authority = materialized.get(binding);
  requireFact(authority !== undefined && candidates.has(authority), 'BINDING');
  requireFact(Object.isFrozen(binding) && !existsSync(binding.staging), 'BINDING');
  assertMoveLocations(binding.original, binding.staging, binding.root, workspaceRoot);
  const identity = lstatSync(binding.root);
  requireFact(identity.ino === binding.directoryIdentity.ino && identity.dev === binding.directoryIdentity.dev, 'BINDING');
  assertPackageTree(binding.original, authority.expected);
  assertPackageTree(binding.root, authority.expected);
  return authority;
}

export function resolveImportPath(specifier, parentURL, policy) {
  if (specifier.startsWith('node:')) {
    requireFact(policy.allowedBuiltins.includes(specifier), 'IMPORT_BINDING', specifier);
    requireFact(parentURL && within(policy.root, fileURLToPath(parentURL)), 'IMPORT_BINDING', 'builtin parent');
    return specifier;
  }
  requireFact(!specifier.includes('?') && !specifier.includes('#') && !specifier.includes('node_modules'), 'IMPORT_BINDING', specifier);
  let target;
  if (parentURL === policy.hookParent && Object.values(policy.entries).includes(specifier)) target = new URL(specifier);
  else {
    requireFact(parentURL?.startsWith('file:') && within(policy.root, fileURLToPath(parentURL)), 'IMPORT_BINDING', 'parent');
    requireFact(specifier.startsWith('./') || specifier.startsWith('../'), 'IMPORT_BINDING', specifier);
    target = new URL(specifier, parentURL);
  }
  const path = fileURLToPath(target);
  requireFact(!within(policy.workspace, path), 'WORKSPACE', path);
  requireFact(path.endsWith('.js'), 'IMPORT_KIND', path);
  requireFact(within(policy.root, path) && Object.hasOwn(policy.files, relative(policy.root, path)), 'IMPORT_BINDING', path);
  return target.href;
}

export function resolveMaterialized(binding, specifier, parentURL = import.meta.url) {
  const authority = assertBound(binding);
  const entries = Object.fromEntries(Object.entries(authority.receipt.entries).map(([name, path]) => [name, pathToFileURL(join(binding.root, path)).href]));
  return resolveImportPath(specifier, parentURL, { root: binding.root, workspace: workspaceRoot, entries, files: authority.expected.files, allowedBuiltins: authority.receipt.allowedBuiltins, hookParent: import.meta.url });
}

export async function withMaterializedImports(binding, requestedEntries, callback) {
  const authority = assertBound(binding);
  requireFact(!importScopeActive && Array.isArray(requestedEntries) && requestedEntries.length > 0 && requestedEntries.every(name => Object.hasOwn(authority.receipt.entries, name)) && new Set(requestedEntries).size === requestedEntries.length, 'IMPORT_SCOPE');
  requireFact(typeof callback === 'function', 'IMPORT_SCOPE');
  importScopeActive = true;
  const imported = [];
  let hooks;
  try {
    hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = resolveMaterialized(binding, specifier, context.parentURL);
      imported.push({ specifier, parentURL: context.parentURL, url });
      return url.startsWith('node:') ? nextResolve(url, context) : { url, shortCircuit: true };
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) { requireFact(authority.receipt.allowedBuiltins.includes(url), 'IMPORT_BINDING', url); return nextLoad(url, context); }
      assertBound(binding);
      const path = fileURLToPath(url);
      requireFact(path.endsWith('.js') && within(binding.root, path), 'IMPORT_KIND', path);
      const identity = authority.expected.files[relative(binding.root, path)];
      const bytes = readFileSync(path);
      requireFact(identity && sha256(bytes) === identity.sha256, 'IMPORT_BINDING', path);
      return { format: 'module', source: bytes, shortCircuit: true };
    },
    });
    const namespaces = {};
    for (const name of requestedEntries) namespaces[name] = await import(pathToFileURL(join(binding.root, authority.receipt.entries[name])).href);
    const value = await callback(Object.freeze(namespaces));
    return { value, imported, proofRole: 'DIRECT_MATERIALIZED_MODULE_NOT_PUBLIC_PACKAGE' };
  } finally {
    hooks?.deregister();
    importScopeActive = false;
    assertBound(binding);
  }
}

export function assertPublicAdmission() {
  requireFact(false, 'PUBLIC_EXPORT_GAP', 'v1 authorizes no root/package export changes; direct module proof cannot admit MOV-02 or public TYPE jobs');
}
