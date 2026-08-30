import assert from 'node:assert/strict';

const original = { id: 'H12', script: 'a=([0]=v [2]=w); b="${a[@]}:${a[@]}"; printf \'%s\\n\' "$b"', status: 'held-adapter-shape', expect: 'Assignment-mode multi-field aggregate behavior must be bound explicitly; do not infer ordinary argv splice applies when split=false. No expected stdout invented.' };
export function additiveHoldouts(holdouts, overlay) {
  assert.deepEqual(Reflect.ownKeys(overlay), ['schema','originalHoldoutsSha256','originalId','versionedId','profile','script','expected','basis']);
  for (const key of Reflect.ownKeys(overlay)) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(overlay, key), 'value'));
  assert.equal(overlay.schema, 'root-ratified-h12-default-ifs-v2');
  assert.equal(overlay.originalHoldoutsSha256, 'b38508ef94dcd8ce42329c7cf1e173ab460a200e3ddb96e4f5e4cfdd8b3e5e95');
  assert.equal(overlay.originalId, 'H12'); assert.equal(overlay.versionedId, 'H12-v2');
  assert.equal(overlay.profile, 'default-IFS-only; isolated virtual environment does not supply IFS');
  assert.equal(overlay.script, original.script);
  assert.deepEqual(Reflect.ownKeys(overlay.expected), ['stdout','stderr','exitCode']);
  for (const key of Reflect.ownKeys(overlay.expected)) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(overlay.expected, key), 'value'));
  assert.equal(overlay.expected.stdout, 'v w:v w\n'); assert.equal(overlay.expected.stderr, ''); assert.equal(overlay.expected.exitCode, 0);
  assert.equal(overlay.basis, 'Root project-profile decision from independent documentation reasoning; not a native observation, candidate proof or G8 implication. Original H12 had no expected output and never ran. No nondefault/empty-IFS inference.');
  assert.equal(holdouts.semantic.length, 16); assert.deepEqual(holdouts.semantic.find(row => row.id === 'H12'), original);
  const prior = holdouts.semantic.filter(row => !row.status); assert.equal(prior.length, 15);
  const result = holdouts.semantic.map(row => row.id === 'H12' ? { id: 'H12-v2', script: overlay.script, stdout: overlay.expected.stdout, stderr: 'empty', exitCode: 0 } : row);
  assert.deepEqual(result.filter(row => row.id !== 'H12-v2'), prior);
  return result;
}
