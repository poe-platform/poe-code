import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isUtf8 } from 'node:buffer';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { createRequire } from 'node:module';
import { ESLint } from 'eslint';
import { loadBoundaries, lintExclusions, validateBoundaries } from '../packages/safe-bash/scripts/integration-inputs.mjs';
import { assertAdmittedInputPath, assertLiteralInputPath, isHeldInputPath } from '../packages/safe-bash/scripts/typecheck-integration-inputs.mjs';

export const LIMITS = Object.freeze({ fileBytes: 16777216, configurationBytes: 268435456, subjectBytes: 268435456, subjects: 12000, metadataOperations: 8000000, directories: 50000, entries: 250000, directoryEntries: 30000, receiptBytes: 131072 });
export const BOUNDARY_RECEIPTS = Object.freeze({ path: 'packages/safe-bash/integration-lint-audit/boundary-leaf-receipts.json', bytes: 29399, sha256: '80463efffa0b8939e69fd1e52ea36c0a13982ff417ef844eb8830173072e9423' });
export const BOUNDARY_POLICY = Object.freeze({ path: 'packages/safe-bash/integration-boundaries.json', bytes: 2534, sha256: 'e06233940cee80600574ff75b1fda7b6c885205822495771d37a9b5e48b51429' });
const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint/package.json'));
const { ConfigArray } = eslintRequire('@eslint/config-array');
const supportedKeys = new Set(['name', 'files', 'ignores', 'languageOptions', 'linterOptions', 'processor', 'plugins', 'rules', 'settings', 'language']);
const packagePrefix = 'packages/safe-bash';
const rootLinkOwnerPath = 'packages/safe-bash/integration-lint-audit/root-claude-link-owner.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identityKeys = ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeMs', 'ctimeMs'];
const failureContexts = new AsyncLocalStorage();

export function withLintFailureDiagnostics(operation) {
  const context = { failure: null };
  return failureContexts.run(context, () => operation(() => context.failure));
}

function exactKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'object required');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'unexpected receipt keys');
}

function bindingShape(binding) {
  assertLiteralInputPath(binding.path);
  assert.ok(Number.isSafeInteger(binding.bytes) && binding.bytes >= 0 && binding.bytes <= LIMITS.fileBytes, 'invalid binding size');
  assert.ok(typeof binding.sha256 === 'string' && binding.sha256.length === 64 && [...binding.sha256].every(character => '0123456789abcdef'.includes(character)), 'invalid binding hash');
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateRootLinkOwner(bytes) {
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), {
    "version": 1,
    "link": {
      "path": "CLAUDE.md",
      "mode": "120000",
      "bytes": 9,
      "sha256": "a54ff182c7e8acf56acfd6e4b9c3ff41e2c41a31c9b211b2deb9df75d9a478f9",
      "target": "AGENTS.md"
    },
    "observations": [
      {
        "commit": "e6b70989225781249f2cf395b927186894fad7c2",
        "tree": "a2bb9b2b9077e6db8ac49373074a05fcef73b0b6",
        "blob": "47dc3e3d863cfb5727b87d785d09abf9743c0a72"
      },
      {
        "commit": "8bdd30a7c804e646fdf2c569bc6bdabd408f301c",
        "tree": "3369aada744bf6fc82a99aefe33db2b61b4ac884",
        "blob": "47dc3e3d863cfb5727b87d785d09abf9743c0a72"
      }
    ]
  }, 'root link Git observations changed');
}

export function createLintInputGuard({ root, boundaries, fileSystem = fs, limits: overrides = {}, bootstrap = false }) {
  assert.ok(typeof root === 'string' && root.startsWith('/') && root !== '/', 'absolute POSIX root required');
  assertLiteralInputPath(root.slice(1));
  assert.equal(typeof bootstrap, 'boolean', 'invalid bootstrap mode');
  assert.ok(!bootstrap || boundaries === undefined, 'bootstrap policy must be authenticated');
  let held = bootstrap ? null : structuredClone(boundaries);
  let protectedDirectories = [];
  function installPolicy(policy) {
    assert.ok(Array.isArray(policy.heldSourceFiles) && Array.isArray(policy.heldEvidenceDirectories), 'held boundaries required');
    for (const path of [...policy.heldSourceFiles, ...policy.heldEvidenceDirectories]) assertLiteralInputPath(path);
    held = freeze(structuredClone(policy));
    protectedDirectories = [...held.heldEvidenceDirectories, ...held.heldSourceFiles.map(path => posix.dirname(path))].map(path => packagePrefix + '/' + path);
  }
  if (held !== null) installPolicy(held);
  const fixedBootstrapPaths = ['package.json', 'eslint.config.js', 'scripts/lint-input-guard.mjs', 'scripts/lint-eslint.mjs', BOUNDARY_POLICY.path, BOUNDARY_RECEIPTS.path];
  let permittedReads = bootstrap ? new Set(fixedBootstrapPaths) : null;
  assert.ok(Object.keys(overrides).every(key => Object.hasOwn(LIMITS, key)), 'unknown input limit');
  const limits = { ...LIMITS, ...overrides };
  for (const key of Object.keys(limits)) assert.ok(Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= LIMITS[key], 'invalid input limit: ' + key);
  assert.ok(Number.isInteger(fileSystem.constants.O_NOFOLLOW) && fileSystem.constants.O_NOFOLLOW !== 0, 'O_NOFOLLOW required');
  assert.ok(Number.isInteger(fileSystem.constants.O_NONBLOCK) && fileSystem.constants.O_NONBLOCK !== 0, 'O_NONBLOCK required');
  const counters = { metadataOperations: 0, directories: 0, entries: 0, configurationBytes: 0, subjectBytes: 0, subjects: 0, opens: 0, closes: 0, readCalls: 0, readBytes: 0, receiptChecks: 0 };
  const receipts = new Map();
  const subjects = new Set();
  let failed = false;
  let reading = false;
  let used = false;
  let receiptsLoaded = false;
  let receiptsStarted = false;
  let receiptsComplete = false;
  let receiptPacket;
  let loadedBinding;
  let lastMetadata = null;
  let lastInput = null;

  function budget(condition, message) {
    if (!condition) {
      failed = true;
      throw Object.assign(new Error(message), { code: 'LINT_LIMIT' });
    }
  }

  function metadata(method, ...args) {
    assert.ok(!failed, 'input guard failed');
    lastMetadata = { method, path: typeof args[0] === 'string' ? args[0] : null, descriptor: typeof args[0] === 'number' ? args[0] : null, admitted: false, completed: false };
    budget(counters.metadataOperations < limits.metadataOperations, 'metadata operation cap');
    counters.metadataOperations++;
    lastMetadata.admitted = true;
    const value = fileSystem[method](...args);
    lastMetadata.completed = true;
    return value;
  }

  function admitted(path) {
    assertLiteralInputPath(path);
    if (held === null) {
      assert.ok(fixedBootstrapPaths.includes(path), 'fixed bootstrap metadata only');
      return;
    }
    const folded = path.toLowerCase();
    if (folded === packagePrefix || folded.startsWith(packagePrefix + '/')) {
      assert.ok(path === packagePrefix || path.startsWith(packagePrefix + '/'), 'case alias of package boundary');
      if (path !== packagePrefix) assertAdmittedInputPath(path.slice(packagePrefix.length + 1), held);
    }
  }

  function rawLeaf(path) {
    assert.ok(receipts.has(path), 'special leaf requires an authenticated exact receipt');
    const parts = path.split('/');
    assert.ok(parts.every(part => part !== '' && part !== '.' && part !== '..' && !part.includes('\0')), 'invalid POSIX leaf');
    if (path !== 'CLAUDE.md') admitted(parts.slice(0, -1).join('/'));
    const folded = path.toLowerCase();
    assert.ok(!protectedDirectories.some(directory => folded === directory.toLowerCase() || folded.startsWith(directory.toLowerCase() + '/')), 'held receipt leaf');
  }

  function names(absolute) {
    const values = metadata('readdirSync', absolute, { encoding: 'buffer' });
    budget(Array.isArray(values) && values.length <= limits.directoryEntries, 'directory entry cap');
    const strings = values.map(value => {
      assert.ok(Buffer.isBuffer(value), 'byte-exact directory names required');
      assert.ok(isUtf8(value), 'invalid directory entry encoding');
      const name = value.toString('utf8');
      assert.ok(!name.includes('/') && !name.includes('\0'), 'invalid directory entry encoding');
      return name;
    });
    assert.equal(new Set(strings).size, strings.length, 'duplicate directory entry');
    return strings;
  }

  function scalar(value) {
    const type = typeof value;
    const text = type === 'number' && Object.is(value, -0) ? '-0' : value === null ? 'null' : ['number', 'bigint', 'boolean', 'string', 'undefined'].includes(type) ? String(value) : type;
    return { type, value: text.slice(0, 96), truncated: text.length > 96 };
  }

  function same(actual, expected, absolute, phase) {
    const outside = absolute === '/' || root.startsWith(absolute + '/');
    for (const key of outside ? ['dev', 'ino', 'mode'] : identityKeys) {
      const observed = actual[key];
      const previous = expected[key];
      if (!Object.is(observed, previous)) {
        const attribution = { path: absolute.slice(0, 256), pathTruncated: absolute.length > 256, phase, field: key, expected: scalar(previous), observed: scalar(observed) };
        const error = new assert.AssertionError({ message: 'filesystem identity drift: ' + key + ' ' + JSON.stringify(attribution) });
        error.actual = observed;
        error.expected = previous;
        error.operator = 'strictEqual';
        throw error;
      }
    }
  }

  function inspect(path, receipt = false, validateSegment) {
    assert.ok(!failed, 'input guard failed');
    assert.equal(typeof path, 'string', 'literal input path required');
    const folded = path.toLowerCase();
    for (const boundary of receipts.keys()) {
      const boundaryFolded = boundary.toLowerCase();
      assert.ok(!folded.startsWith(boundaryFolded + '/') && (folded !== boundaryFolded || (receipt && path === boundary)), 'metadata-only receipt boundary');
    }
    if (path !== '') {
      if (receipt) rawLeaf(path);
      else admitted(path);
    }
    const absolute = path === '' ? root : root + '/' + path;
    const parts = absolute.slice(1).split('/');
    let parent = '/';
    let parentStat = metadata('lstatSync', parent);
    const rootStat = parentStat;
    assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'regular root ancestor required');
    for (const [index, part] of parts.entries()) {
      assert.ok(names(parent).includes(part), 'exact pathname spelling required');
      const next = parent === '/' ? '/' + part : parent + '/' + part;
      const stat = metadata('lstatSync', next);
      if (validateSegment) validateSegment(next, stat);
      if (index === parts.length - 1) {
        if (!receipt && !stat.isSymbolicLink()) assert.equal(metadata('realpathSync', next), next, 'canonical pathname required');
        return { absolute: next, stat, parent, parentStat, rootStat };
      }
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'regular non-symlink ancestor required');
      assert.equal(metadata('realpathSync', next), next, 'canonical ancestor required');
      parent = next;
      parentStat = stat;
    }
    throw new Error('missing input path');
  }

  function regular(stat, maximum) {
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'regular non-symlink input required');
    assert.equal(stat.nlink, 1, 'single-link input required');
    budget(Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= maximum, 'individual input cap');
  }

  function read(path, phase = 'configuration', maximum = limits.fileBytes) {
    assert.ok(!reading && !failed, 'input guard is busy or failed');
    lastInput = Object.freeze({ path: typeof path === 'string' ? path : null, phase: typeof phase === 'string' ? phase : null });
    reading = true;
    try {
      assert.ok(phase === 'configuration' || phase === 'subject', 'unknown input phase');
      assert.ok(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= limits.fileBytes, 'invalid read bound');
      assert.ok(permittedReads === null || permittedReads.has(path), 'bootstrap payload is not admitted');
      admitted(path);
      const input = inspect(path);
      regular(input.stat, maximum);
      const counter = phase === 'subject' ? 'subjectBytes' : 'configurationBytes';
      if (phase === 'subject') {
        assert.ok(!subjects.has(path), 'duplicate lint subject');
        budget(counters.subjects < limits.subjects, 'subject cap');
        subjects.add(path);
        counters.subjects++;
      }
      budget(counters[counter] + input.stat.size <= limits[counter], 'aggregate input cap');
      counters[counter] += input.stat.size;
      counters.opens++;
      const descriptor = fileSystem.openSync(input.absolute, fileSystem.constants.O_RDONLY | fileSystem.constants.O_NOFOLLOW | fileSystem.constants.O_NONBLOCK);
      let bytes;
      let hasPrimaryFailure = false;
      let primaryFailure;
      try {
        const before = metadata('fstatSync', descriptor);
        regular(before, maximum);
        same(before, input.stat, input.absolute, 'descriptor-before');
        bytes = Buffer.alloc(input.stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const requested = Math.min(65536, bytes.length - offset);
          counters.readCalls++;
          const count = fileSystem.readSync(descriptor, bytes, offset, requested, null);
          assert.ok(Number.isInteger(count) && count > 0 && count <= requested, 'short or invalid descriptor read');
          offset += count;
          counters.readBytes += count;
        }
        const after = metadata('fstatSync', descriptor);
        regular(after, maximum);
        same(after, input.stat, input.absolute, 'descriptor-after');
      } catch (error) {
        hasPrimaryFailure = true;
        primaryFailure = error;
      }
      let hasCloseFailure = false;
      let closeFailure;
      try {
        fileSystem.closeSync(descriptor);
        counters.closes++;
      } catch (error) {
        hasCloseFailure = true;
        closeFailure = error;
      }
      if (hasPrimaryFailure && hasCloseFailure) throw new AggregateError([primaryFailure, closeFailure], 'lint input read and close failed');
      if (hasPrimaryFailure) throw primaryFailure;
      if (hasCloseFailure) throw closeFailure;
      same(metadata('lstatSync', input.absolute), input.stat, input.absolute, 'read-leaf-after');
      same(metadata('lstatSync', input.parent), input.parentStat, input.parent, 'read-parent-after');
      return bytes;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      reading = false;
    }
  }

  function directory(path, inspectEntries = false) {
    const ancestors = [];
    const input = inspect(path, false, inspectEntries ? (absolute, stat) => ancestors.push({ absolute, identity: Object.fromEntries(identityKeys.map(key => [key, stat[key]])) }) : undefined);
    if (inspectEntries) ancestors.unshift({ absolute: '/', identity: Object.fromEntries(identityKeys.map(key => [key, input.rootStat[key]])) });
    assert.ok(input.stat.isDirectory() && !input.stat.isSymbolicLink(), 'regular non-symlink directory required');
    budget(counters.directories < limits.directories, 'directory cap');
    const entries = names(input.absolute).sort();
    budget(counters.entries + entries.length <= limits.entries, 'aggregate directory entry cap');
    counters.directories++;
    counters.entries += entries.length;
    same(metadata('lstatSync', input.absolute), input.stat, input.absolute, 'directory-listed');
    const result = { entries, identity: Object.fromEntries(identityKeys.map(key => [key, input.stat[key]])), entriesSha256: digest(Buffer.from(JSON.stringify(entries))) };
    if (!inspectEntries) return result;
    const inspections = new Map();
    let failurePath = path;
    try {
      for (const name of entries) {
        const child = path === '' ? name : path + '/' + name;
        failurePath = child;
        if (receipts.has(child)) continue;
        try {
          const folded = child.toLowerCase();
          for (const boundary of receipts.keys()) {
            const boundaryFolded = boundary.toLowerCase();
            assert.ok(folded !== boundaryFolded && !folded.startsWith(boundaryFolded + '/'), 'metadata-only receipt boundary');
          }
          admitted(child);
          for (const ancestor of ancestors) {
            if (ancestor.absolute !== '/') assert.ok(names(posix.dirname(ancestor.absolute)).includes(posix.basename(ancestor.absolute)), 'exact ancestor pathname spelling required');
            const current = metadata('lstatSync', ancestor.absolute);
            assert.ok(current.isDirectory() && !current.isSymbolicLink(), 'regular non-symlink ancestor required');
            same(current, ancestor.identity, ancestor.absolute, 'directory-entry-ancestor');
            assert.equal(metadata('realpathSync', ancestor.absolute), ancestor.absolute, 'canonical ancestor required');
          }
          assert.ok(names(input.absolute).includes(name), 'exact child pathname spelling required');
          const absolute = input.absolute + '/' + name;
          const stat = metadata('lstatSync', absolute);
          if (!stat.isSymbolicLink()) assert.equal(metadata('realpathSync', absolute), absolute, 'canonical pathname required');
          assert.ok(!stat.isSymbolicLink(), 'symlink boundary left unread and untraversed');
          assert.ok(stat.isDirectory() || stat.isFile(), 'nonregular boundary left unread');
          if (stat.isFile()) assert.equal(stat.nlink, 1, 'hardlink boundary left unread');
          inspections.set(name, { kind: stat.isDirectory() ? 'directory' : 'file' });
        } catch (error) {
          if (failed) throw error;
          inspections.set(name, { error });
        }
      }
      failurePath = path;
      const after = inspect(path);
      same(after.stat, input.stat, input.absolute, 'directory-final');
      same(after.parentStat, input.parentStat, input.parent, 'directory-parent-final');
      return { ...result, inspections };
    } catch (failure) {
      return { ...result, inspections, failure, failurePath };
    }
  }

  function authenticated(binding, maximum = limits.fileBytes) {
    bindingShape(binding);
    const bytes = read(binding.path, 'configuration', Math.min(maximum, limits.fileBytes));
    assert.equal(bytes.length, binding.bytes, 'binding byte count changed');
    assert.equal(digest(bytes), binding.sha256, 'binding hash changed');
    return bytes;
  }

  function prepareReceipts(binding) {
    assert.ok(!receiptsStarted && !failed && held !== null, 'receipts already started or policy unavailable');
    receiptsStarted = true;
    try {
      exactKeys(binding, ['path', 'bytes', 'sha256']);
      const packet = JSON.parse(authenticated(binding, limits.receiptBytes).toString('utf8'));
      exactKeys(packet, ['version', 'inventory', 'records']);
      assert.equal(packet.version, 2, 'unsupported receipt version');
      exactKeys(packet.inventory, ['path', 'bytes', 'sha256']);
      bindingShape(packet.inventory);
      assert.ok(Array.isArray(packet.records) && packet.records.length === 25, 'exactly 25 leaf receipts required');
      const paths = new Set();
      const identifiers = new Set();
      const groups = new Map();
      let regularCount = 0;
      let ignoredCount = 0;
      for (const record of packet.records) {
        exactKeys(record, ['id', 'group', 'path', 'kind', 'selection', 'target', 'owners', 'inventoryRecord', 'companion']);
        assert.ok(typeof record.id === 'string' && !identifiers.has(record.id), 'duplicate receipt id');
        identifiers.add(record.id);
        const rootLeaf = record.path === 'CLAUDE.md';
        assert.equal(record.group === 'root-claude-link-1', rootLeaf, 'root receipt group requires its exact path');
        assert.ok(typeof record.path === 'string' && (rootLeaf || record.path.startsWith(packagePrefix + '/')) && !paths.has(record.path), 'duplicate or outside receipt path');
        const parts = record.path.split('/');
        assert.ok(parts.every(part => part !== '' && part !== '.' && part !== '..' && !part.includes('\0')), 'nonliteral POSIX receipt path');
        if (!rootLeaf) admitted(parts.slice(0, -1).join('/'));
        paths.add(record.path);
        assert.ok(record.kind === 'regular' || record.kind === 'symlink', 'unsupported receipt kind');
        assert.ok(record.selection === 'unconfigured' || record.selection === 'ignored', 'unsupported receipt selection');
        if (record.kind === 'regular') {
          regularCount++;
          assert.equal(record.target, null);
        } else assert.ok(typeof record.target === 'string' && record.target.length > 0 && !record.target.includes('\0'), 'literal symlink target required');
        if (record.selection === 'ignored') ignoredCount++;
        groups.set(record.group, (groups.get(record.group) ?? 0) + 1);
        assert.ok(Array.isArray(record.owners) && record.owners.length > 0, 'owner binding required');
        if (rootLeaf) {
          assert.equal(record.id, 'root-claude-link');
          assert.equal(record.group, 'root-claude-link-1');
          assert.equal(record.kind, 'symlink');
          assert.equal(record.selection, 'unconfigured');
          assert.equal(record.target, 'AGENTS.md');
          assert.equal(record.owners.length, 1);
          assert.equal(record.owners[0].path, rootLinkOwnerPath);
          assert.deepEqual(record.owners[0].selectors, ['/link', '/observations/0', '/observations/1'], 'root link owner selectors changed');
        } else {
          assert.ok(record.owners.every(owner => owner.path !== rootLinkOwnerPath), 'root link owner is root-only');
        }
        for (const owner of record.owners) {
          exactKeys(owner, ['path', 'bytes', 'sha256', 'selectors']);
          bindingShape(owner);
          admitted(owner.path);
          assert.ok(Array.isArray(owner.selectors) && owner.selectors.length > 0 && owner.selectors.every(selector => typeof selector === 'string' && selector.length > 0), 'reviewed selector references required');
        }
        if (record.group === 'inventory-worker-links-2') {
          assert.ok(typeof record.inventoryRecord === 'string', 'inventory record required');
          assert.equal(record.kind, 'symlink');
          assert.equal(record.selection, 'ignored');
          exactKeys(record.companion, ['path', 'bytes', 'sha256']);
          bindingShape(record.companion);
          assert.equal(packagePrefix + '/' + record.companion.path, posix.dirname(record.path) + '/' + record.target, 'inventory companion pathname changed');
        } else {
          assert.equal(record.inventoryRecord, null);
          assert.equal(record.companion, null);
          assert.equal(record.selection, 'unconfigured');
        }
      }
      assert.deepEqual(Object.fromEntries(groups), { 'tree-fixtures-20': 20, 'inventory-worker-links-2': 2, 'admission-links-2': 2, 'root-claude-link-1': 1 }, 'receipt groups changed');
      assert.equal(regularCount, 8, 'receipt regular count changed');
      assert.equal(ignoredCount, 2, 'receipt ignore count changed');
      const owners = new Map();
      for (const record of packet.records) for (const owner of record.owners) {
        assert.ok(![...paths].some(path => owner.path === path || owner.path.startsWith(path + '/')), 'leaf payload cannot be an owner');
        const previous = owners.get(owner.path);
        if (previous) assert.ok(previous.bytes === owner.bytes && previous.sha256 === owner.sha256, 'contradictory owner identity');
        owners.set(owner.path, owner);
      }
      assert.ok(![...paths].some(path => packet.inventory.path === path || packet.inventory.path.startsWith(path + '/')), 'inventory cannot be a receipt leaf');
      assert.ok(![...owners.keys()].some(path => path.toLowerCase() === packet.inventory.path.toLowerCase()), 'inventory cannot be a receipt owner');
      for (const record of packet.records) receipts.set(record.path, freeze(record));
      if (bootstrap) permittedReads = new Set([...fixedBootstrapPaths, ...owners.keys()]);
      for (const owner of owners.values()) {
        const bytes = authenticated(owner);
        if (owner.path === rootLinkOwnerPath) validateRootLinkOwner(bytes);
      }
      receiptPacket = freeze(packet);
      loadedBinding = freeze(structuredClone(binding));
      receiptsLoaded = true;
      return Object.freeze([...receipts.values()]);
    } catch (error) {
      failed = true;
      throw error;
    }
  }

  function available() {
    assert.ok(!bootstrap || receiptsComplete, 'bootstrap filesystem is not ready');
    assert.ok(!failed, 'input guard failed');
  }

  function finishReceipts() {
    try {
      const packet = receiptPacket;
      if (bootstrap) permittedReads.add(packet.inventory.path);
      const inventory = JSON.parse(authenticated(packet.inventory).toString('utf8'));
      assert.ok(Array.isArray(inventory.records), 'inventory records required');
      for (const record of packet.records.filter(record => record.inventoryRecord !== null)) {
        const selected = inventory.records.filter(item => item.id === record.inventoryRecord);
        assert.equal(selected.length, 1, 'inventory receipt record changed');
        const item = selected[0];
        assert.deepEqual(item.symlinks.filter(link => packagePrefix + '/' + link.path === record.path), [{ path: record.path.slice(packagePrefix.length + 1), target: record.target }], 'inventory symlink binding changed');
        assert.deepEqual(item.members.filter(member => member.path === record.companion.path), [record.companion], 'inventory companion binding changed');
        for (const owner of record.owners) assert.deepEqual(item.owners.filter(bound => packagePrefix + '/' + bound.path === owner.path), [{ path: owner.path.slice(packagePrefix.length + 1), bytes: owner.bytes, sha256: owner.sha256 }], 'inventory owner binding changed');
      }
      receiptsComplete = true;
      permittedReads = null;
      return Object.freeze([...receipts.values()]);
    } catch (error) {
      failed = true;
      throw error;
    }
  }

  function loadReceipts(binding = BOUNDARY_RECEIPTS) {
    assert.ok(!failed, 'input guard failed');
    if (receiptsComplete) {
      assert.deepEqual(binding, loadedBinding, 'completed receipt binding changed');
      return Object.freeze([...receipts.values()]);
    }
    assert.ok(!bootstrap, 'bootstrap requires verified receipt initialization');
    prepareReceipts(binding);
    return finishReceipts();
  }

  async function initializeReceipts(select, binding = BOUNDARY_RECEIPTS) {
    assert.ok(bootstrap && !receiptsStarted && !failed, 'bootstrap receipts already started or guard failed');
    try {
      const records = prepareReceipts(binding);
      const selection = await select(records);
      for (const record of records) await verifyReceipt(record, selection);
      return finishReceipts();
    } catch (error) {
      failed = true;
      throw error;
    }
  }

  function receiptMetadata(record, validateSegment) {
    assert.ok(receiptsLoaded && receipts.get(record.path) === record, 'authenticated receipt required');
    const input = inspect(record.path, true, validateSegment);
    assert.equal(input.stat.nlink, 1, 'single-link receipt required');
    if (record.path === 'CLAUDE.md') assert.equal(input.stat.size, 9, 'root link size changed');
    if (record.kind === 'regular') assert.ok(input.stat.isFile() && !input.stat.isSymbolicLink(), 'receipt leaf kind changed');
    else {
      assert.ok(input.stat.isSymbolicLink(), 'receipt leaf kind changed');
      const target = metadata('readlinkSync', input.absolute, { encoding: 'buffer' });
      assert.ok(Buffer.isBuffer(target) && target.equals(Buffer.from(record.target, 'utf8')), 'receipt link target changed');
    }
    same(metadata('lstatSync', input.absolute), input.stat, input.absolute, 'receipt-leaf-after');
    same(metadata('lstatSync', input.parent), input.parentStat, input.parent, 'receipt-parent-after');
    counters.receiptChecks++;
    return input;
  }

  async function verifyReceipt(record, selection) {
    assert.ok(receiptsLoaded && receipts.get(record.path) === record, 'authenticated receipt required');
    assert.equal(await selection.classify(root + '/' + record.path), record.selection, 'receipt selection changed');
    const before = receiptMetadata(record);
    const after = receiptMetadata(record);
    same(after.stat, before.stat, before.absolute, 'receipt-verify-leaf');
    same(after.parentStat, before.parentStat, before.parent, 'receipt-verify-parent');
    return Object.freeze({ path: record.path, kind: record.kind, selection: record.selection, metadataOnly: true, identity: Object.fromEntries(identityKeys.map(key => [key, after.stat[key]])) });
  }

  function absoluteInput(absolute) {
    assert.ok(typeof absolute === 'string', 'literal absolute path required');
    if (absolute === root) return '';
    if (absolute.startsWith(root + '/')) return absolute.slice(root.length + 1);
    assert.ok(absolute === '/' || root.startsWith(absolute + '/'), 'filesystem operation outside root');
    inspect('');
    return null;
  }

  const guardedFileSystem = Object.freeze({
    inspectAdmittedInput(absolute, validateSegment) {
      available();
      assert.equal(typeof validateSegment, 'function', 'segment validator required');
      const path = absoluteInput(absolute);
      assert.ok(path !== null && path !== '', 'input must be inside root');
      return receipts.has(path) ? receiptMetadata(receipts.get(path), validateSegment) : inspect(path, false, validateSegment);
    },
    readAdmittedInput(absolute, maximum) {
      available();
      assert.ok(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= limits.fileBytes, 'invalid read bound');
      const path = absoluteInput(absolute);
      assert.ok(path !== null && path !== '', 'payload must be inside root');
      return read(path, 'configuration', maximum);
    },
    readdirSync(absolute, options) {
      available();
      assert.ok(options === undefined || (options && Object.keys(options).length === 1 && options.encoding === 'buffer'), 'unsupported directory read options');
      const path = absoluteInput(absolute);
      const entries = path === null ? names(absolute) : directory(path).entries;
      return options ? entries.map(name => Buffer.from(name, 'utf8')) : entries;
    },
    lstatSync(absolute) {
      available();
      const path = absoluteInput(absolute);
      if (path === null) return metadata('lstatSync', absolute);
      return (receipts.has(path) ? receiptMetadata(receipts.get(path)) : inspect(path)).stat;
    },
    realpathSync(absolute) {
      available();
      const path = absoluteInput(absolute);
      if (path !== null) assert.ok(!inspect(path).stat.isSymbolicLink(), 'symlink canonicalization forbidden');
      assert.equal(metadata('realpathSync', absolute), absolute, 'canonical pathname required');
      return absolute;
    },
    readFileSync(absolute, options) {
      available();
      assert.equal(options, undefined, 'unsupported payload read options');
      const path = absoluteInput(absolute);
      assert.ok(path !== null && path !== '', 'payload must be inside root');
      return read(path, 'configuration');
    },
    readlinkSync(absolute) {
      available();
      const path = absoluteInput(absolute);
      assert.ok(path !== null && path !== '', 'link must be inside root');
      const input = receipts.has(path) ? receiptMetadata(receipts.get(path)) : inspect(path);
      assert.ok(input.stat.isSymbolicLink(), 'symlink metadata required');
      const value = metadata('readlinkSync', absolute, { encoding: 'buffer' });
      same(metadata('lstatSync', absolute), input.stat, absolute, 'readlink-leaf-after');
      same(metadata('lstatSync', input.parent), input.parentStat, input.parent, 'readlink-parent-after');
      assert.ok(Buffer.isBuffer(value) && Buffer.from(value.toString('utf8'), 'utf8').equals(value), 'invalid link text encoding');
      return value.toString('utf8');
    },
  });

  return Object.freeze({
    root,
    fileSystem: guardedFileSystem,
    read,
    inspect(path) {
      available();
      return receipts.has(path) ? receiptMetadata(receipts.get(path)) : inspect(path);
    },
    directory(path, inspectEntries = false) {
      available();
      assert.equal(typeof inspectEntries, 'boolean', 'invalid directory inspection mode');
      return directory(path, inspectEntries);
    },
    loadPolicy(binding = BOUNDARY_POLICY) {
      assert.ok(bootstrap && held === null && !failed, 'bootstrap policy already installed or guard failed');
      try {
        assert.equal(binding.path, BOUNDARY_POLICY.path, 'fixed boundary policy path required');
        installPolicy(validateBoundaries(JSON.parse(authenticated(binding).toString('utf8'))));
        return held;
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    initializeReceipts,
    loadReceipts,
    invalidate() { failed = true; },
    verifyReceipt,
    isHeld(path) {
      assert.ok(held !== null, 'held policy unavailable');
      assertLiteralInputPath(path);
      const folded = path.toLowerCase();
      if (folded !== packagePrefix && !folded.startsWith(packagePrefix + '/')) return false;
      assert.ok(path === packagePrefix || path.startsWith(packagePrefix + '/'), 'case alias of package boundary');
      return path !== packagePrefix && isHeldInputPath(path.slice(packagePrefix.length + 1), held);
    },
    snapshot: () => Object.freeze({ ...counters, failed, reading, used, bootstrap, receiptsComplete, lastMetadata: lastMetadata === null ? null : Object.freeze({ ...lastMetadata }), lastInput }),
    begin() {
      available();
      assert.ok(!used && !failed, 'guard already used or failed');
      used = true;
    },
  });
}

export function compactLiteralIgnores(patterns) {
  const result = [];
  let batch = [], length = 2;
  function flush() {
    if (batch.length > 1) result.push('{' + batch.join(',') + '}');
    else result.push(...batch);
    batch = [];
    length = 2;
  }
  for (const pattern of patterns) {
    // Only positive, unescaped literal paths can be joined without changing
    // ignore order or introducing another interpretation of glob syntax.
    const literal = pattern.includes('/') && !pattern.endsWith('/') && [...pattern].every(character => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/._-'.includes(character));
    if (!literal || batch.length === 32 || length + pattern.length + 1 > 32768) flush();
    if (!literal) result.push(pattern);
    else {
      batch.push(pattern);
      length += pattern.length + 1;
    }
  }
  flush();
  return result;
}

export function createLintSelection(root, config) {
  assert.equal(ESLint.version, '9.39.4', 'unsupported ESLint version; compatibility review required');
  assert.ok(Array.isArray(config), 'unsupported root configuration');
  let profile = [...config, { files: ['**/*.ts'] }];
  const all = [...ESLint.defaultConfig, ...profile];
  for (const entry of all) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), 'unsupported configuration entry');
    assert.ok(Object.keys(entry).every(key => supportedKeys.has(key)), 'unsupported configuration shape');
    if (entry.files !== undefined) assert.ok(Array.isArray(entry.files) && entry.files.length > 0 && entry.files.every(pattern => typeof pattern === 'string' || (Array.isArray(pattern) && pattern.length > 0 && pattern.every(part => typeof part === 'string'))), 'unsupported files matcher');
    if (entry.ignores !== undefined) assert.ok(Array.isArray(entry.ignores) && entry.ignores.every(pattern => typeof pattern === 'string'), 'unsupported ignores matcher');
  }
  const globalIgnores = all.filter(entry => Object.hasOwn(entry, 'ignores') && Object.keys(entry).every(key => key === 'name' || key === 'ignores'));
  const compacted = new Map(globalIgnores.map(entry => [entry, { ...entry, ignores: compactLiteralIgnores(entry.ignores) }]));
  profile = profile.map(entry => compacted.get(entry) ?? entry);
  const projection = new ConfigArray(globalIgnores.map(entry => compacted.get(entry)), { basePath: root });
  projection.normalizeSync();
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: profile, fix: false });
  return Object.freeze({
    eslint,
    directoryIgnored: absolute => projection.isDirectoryIgnored(absolute),
    async classify(absolute) {
      const config = await eslint.calculateConfigForFile(absolute);
      if (config !== undefined) return 'configured';
      return projection.isFileIgnored(absolute) ? 'ignored' : 'unconfigured';
    },
  });
}

export async function initializeLintConfiguration({ root, fileSystem = fs, buildConfig, boundaryBinding = BOUNDARY_POLICY, receiptBinding = BOUNDARY_RECEIPTS, loadBoundaries: boundaryLoader = loadBoundaries, lintExclusions: inputLoader = lintExclusions, limits }) {
  const context = failureContexts.getStore();
  if (context) context.failure = null;
  assert.equal(typeof buildConfig, 'function', 'configuration factory required');
  const guard = createLintInputGuard({ root, fileSystem, bootstrap: true, limits });
  let phase = 'boundary-policy';
  try {
    const policy = guard.loadPolicy(boundaryBinding);
    phase = 'receipt-registration';
    const records = await guard.initializeReceipts(records => createLintSelection(root, buildConfig({ files: records.filter(record => record.selection === 'ignored').map(record => record.path.slice(packagePrefix.length + 1)), directories: [] })), receiptBinding);
    const packageRoot = posix.join(root, packagePrefix);
    phase = 'boundary-provenance';
    const boundaries = boundaryLoader(packageRoot, guard.fileSystem);
    assert.deepEqual(boundaries, policy, 'boundary policy changed during initialization');
    phase = 'inventory-provenance';
    const inputs = inputLoader(packageRoot, boundaries, guard.fileSystem);
    phase = 'configuration';
    const config = buildConfig(inputs, guard.fileSystem, boundaries);
    const selection = createLintSelection(root, config);
    phase = 'final-receipt-selection';
    for (const record of records) await guard.verifyReceipt(record, selection);
    return Object.freeze({ guard, config, boundaries });
  } catch (error) {
    guard.invalidate();
    if (context) context.failure = Object.freeze({ phase, root, counters: guard.snapshot() });
    throw error;
  }
}
