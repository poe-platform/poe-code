import assert from 'node:assert/strict';

export const requiredBindingKeys = Object.freeze([
  'candidateCommit', 'freezeCommit', 'freezeManifestSha256', 'sourceInventory',
  'html74Checkpoint', 'approved75Inventory', 'sourcePathsAndPolicy',
  'aggregateDuOptions', 'diagnostics', 'outputOperationIntegration',
  'supervisorIdentity', 'toolIdentities', 'admissionPolicy', 'replayAuthorization',
]);

function nonempty(value, label) {
  assert.equal(typeof value, 'string', label);
  assert.ok(value.trim().length > 0, label);
}

function digest(value, length, label) {
  assert.match(value ?? '', new RegExp(`^[a-f0-9]{${length}}$`), label);
}

function identity(value, label) {
  assert.ok(value && typeof value === 'object', label);
  nonempty(value.path, `${label}.path`);
  digest(value.sha256, 64, `${label}.sha256`);
}

function names(value, count, label) {
  assert.ok(Array.isArray(value), label);
  assert.equal(value.length, count, `${label} count`);
  assert.equal(new Set(value).size, count, `${label} unique`);
  for (const name of value) {
    nonempty(name, label);
    assert.ok(!/[\s/\0]/u.test(name), label);
  }
}

export function assertDefaultNames(actual, approved) {
  names(approved, 75, 'approved names');
  names(actual, 75, 'actual names');
  assert.deepEqual([...actual].sort(), [...approved].sort(), 'exact default plugin names');
  for (const present of ['du', 'html-to-markdown']) assert.ok(actual.includes(present), present);
  for (const absent of ['getopts', 'curl', 'safejs', 'expr']) assert.ok(!actual.includes(absent), absent);
}

export function assertReplayBindings(document) {
  assert.equal(document?.schemaVersion, 1);
  assert.equal(document.state, 'root-authorized-public-replay', 'freeze alone never authorizes execution');
  const fixed = document.fixedScope;
  assert.deepEqual(fixed, {
    package: 'virtual-bash', subpath: 'virtual-bash/commands/du',
    defaultPluginCount: 75, htmlCheckpointPluginCount: 74,
    getoptsIsBuiltinNotPlugin: true, htmlRequired: true,
    curlAndSafejsOptional: true, exprDefault: false,
    physicalStorageClaims: false, wholeGate: false,
  });
  const bound = document.required;
  assert.ok(bound && typeof bound === 'object');
  assert.deepEqual(Object.keys(bound).sort(), [...requiredBindingKeys].sort());
  for (const key of requiredBindingKeys) assert.ok(bound[key] !== null && bound[key] !== undefined, `UNBOUND ${key}`);
  digest(bound.candidateCommit, 40, 'candidate commit');
  digest(bound.freezeCommit, 40, 'freeze commit');
  digest(bound.freezeManifestSha256, 64, 'freeze manifest');
  assert.ok(Array.isArray(bound.sourceInventory) && bound.sourceInventory.length > 0);
  const paths = new Set();
  for (const entry of bound.sourceInventory) {
    identity(entry, 'source entry');
    assert.ok(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
    assert.ok(!paths.has(entry.path), 'duplicate source path');
    paths.add(entry.path);
    digest(entry.gitBlob, 40, 'source blob');
  }
  digest(bound.html74Checkpoint.commit, 40, 'HTML74 commit');
  identity(bound.html74Checkpoint.evidence, 'HTML74 evidence');
  names(bound.html74Checkpoint.names, 74, 'HTML74 names');
  assert.ok(bound.html74Checkpoint.names.includes('html-to-markdown'));
  assert.ok(!bound.html74Checkpoint.names.includes('du'));
  identity(bound.approved75Inventory.approval, '75-name root approval');
  assertDefaultNames(bound.approved75Inventory.names, bound.approved75Inventory.names);
  assert.deepEqual([...bound.html74Checkpoint.names, 'du'].sort(), [...bound.approved75Inventory.names].sort());
  identity(bound.sourcePathsAndPolicy, 'source paths and policy');
  identity(bound.aggregateDuOptions, 'aggregate DU options declaration/policy');
  nonempty(bound.aggregateDuOptions.propertyPath, 'aggregate DU property path');
  identity(bound.diagnostics, 'diagnostics policy');
  assert.equal(bound.diagnostics.unknownAllocation?.exitCode, 1);
  assert.equal(bound.diagnostics.unknownAllocation?.stdout, '');
  nonempty(bound.diagnostics.unknownAllocation?.stderr, 'unknown allocation exact stderr');
  identity(bound.outputOperationIntegration, 'output operation mapping');
  for (const key of ['headZero', 'firstReadCancel', 'validationAndStderr', 'admissionObservation', 'accountedWrites', 'execSettlement', 'disposeOverlap', 'isolationAndOpaqueBoundary']) {
    identity(bound.outputOperationIntegration[key], `lifecycle ${key}`);
  }
  identity(bound.supervisorIdentity, 'supervisor');
  assert.ok(Array.isArray(bound.toolIdentities) && bound.toolIdentities.length > 0);
  for (const tool of bound.toolIdentities) {
    identity(tool, 'tool');
    nonempty(tool.version, 'tool version');
  }
  identity(bound.admissionPolicy, 'admission policy');
  assert.ok(['scoped-committed-archive'].includes(bound.admissionPolicy.mode));
  assert.equal(bound.admissionPolicy.postRunDetectsNewEntries, true);
  identity(bound.replayAuthorization, 'replay authorization');
  assert.equal(bound.replayAuthorization.candidateCommit, bound.candidateCommit);
  assert.equal(bound.replayAuthorization.freezeCommit, bound.freezeCommit);
  return bound;
}
