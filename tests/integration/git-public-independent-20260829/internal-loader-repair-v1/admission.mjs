import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { internalLoaderArguments } from './internal-loader-arguments.mjs';
export function admit(specification, args, environment) {
  assert.deepEqual(Reflect.ownKeys(environment).sort(), ['PATH', 'HOME', 'TMPDIR', 'LC_ALL', 'NO_COLOR', 'CASE_ID', 'FIXTURE_MANIFEST', 'FIXTURE_LOG'].sort());
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(environment))) { assert.ok(Object.hasOwn(descriptor, 'value')); assert.equal(typeof descriptor.value, 'string'); }
  assert.equal(environment.CASE_ID, specification.caseId);
  assert.equal(environment.FIXTURE_MANIFEST, specification.manifestPath);
  assert.equal(environment.FIXTURE_LOG, specification.logPath);
  assert.equal(environment.PATH, path.dirname(specification.node));
  assert.equal(environment.HOME, specification.output); assert.equal(environment.TMPDIR, specification.output);
  assert.equal(environment.LC_ALL, 'C'); assert.equal(environment.NO_COLOR, '1');
  for (const filename of [specification.loader, specification.bootstrap, specification.consumer]) {
    assert.ok(filename.startsWith(specification.root + path.sep), 'fixture containment');
    const row = specification.files.find(item => item.path === filename); assert.ok(row, 'exact source membership');
    const metadata = fs.lstatSync(filename); assert.ok(metadata.isFile() && !metadata.isSymbolicLink()); assert.equal(fs.realpathSync(filename), filename);
    assert.ok(metadata.size <= 65536); const bytes = fs.readFileSync(filename);
    assert.equal(bytes.length, row.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, 'source identity');
  }
  return internalLoaderArguments(args, specification);
}
