import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const productRevision = '8670ebe8f0d39966c2de2638780437398e5f8490';
export const verifierRevision = 'c800c899114c6c83b3d3eb67231176d124abaf49';
const verifierPath = 'scripts/verify-current-consumers.mjs';
const verifierSha256 = '09d04680a1dd80059fd31da73068c919bb0402d8bdd31a4d0a971a67d8e1259c';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const helperPaths = [
  'tests/plugins/stream-five-public/harness.mjs',
  'tests/plugins/stream-five-public/current-profile.mjs',
  'tests/plugins/qualified-current-release/consumers.mjs',
  'tests/plugins/qualified-current-release/runtime-coverage.mjs',
  'tests/plugins/qualified-current-release/snapshot.mjs',
];

export function stageExternalVerifier({ repository, source, harness, inputs }) {
  const sourceRoot = realpathSync(source), destination = realpathSync(harness);
  assert.ok(!destination.startsWith(sourceRoot + '/') && destination !== sourceRoot);
  const original = execFileSync('git', ['--no-replace-objects', 'show', verifierRevision + ':' + verifierPath], { cwd: repository, maxBuffer: 1024 * 1024 });
  assert.equal(hash(original), verifierSha256);
  const helperBindings = helperPaths.map(path => {
    const target = join(sourceRoot, path);
    assert.ok(lstatSync(target).isFile() && !lstatSync(target).isSymbolicLink());
    assert.equal(realpathSync(target), target);
    const actual = hash(readFileSync(target));
    assert.equal(actual, inputs[path]?.sha256, 'Frozen helper mismatch: ' + path);
    return { path, sha256: actual, specifier: '../' + path, replacement: pathToFileURL(target).href };
  });
  let transformed = original.toString();
  const relativeImports = [...transformed.matchAll(/\bfrom\s*["'](\.[^"']+)["']/gu)].map(match => match[1]);
  assert.deepEqual(relativeImports, helperBindings.map(binding => binding.specifier));
  for (const binding of helperBindings) {
    assert.equal(transformed.split(JSON.stringify(binding.specifier)).length, 2);
    transformed = transformed.replace(JSON.stringify(binding.specifier), JSON.stringify(binding.replacement));
  }
  let reversed = transformed;
  for (const binding of helperBindings) reversed = reversed.replace(JSON.stringify(binding.replacement), JSON.stringify(binding.specifier));
  assert.equal(reversed, original.toString());
  const external = join(destination, 'permission-tap-verifier-v2.mjs');
  writeFileSync(external, transformed, { flag: 'wx' });
  const receipt = { productRevision, verifierRevision, originalPath: verifierPath, originalSha256: verifierSha256,
    transformedSha256: hash(Buffer.from(transformed)), external, helperBindings,
    transformation: 'Only five relative helper import specifiers become authenticated frozen8670 file URLs; function bodies and frozen files unchanged' };
  const driver = join(destination, 'permission-tap-driver-v2.mjs');
  const snapshot = helperBindings.find(binding => binding.path.endsWith('/snapshot.mjs')).replacement;
  const program = `import {currentConsumers} from ${JSON.stringify(pathToFileURL(external).href)};\nimport {snapshot,finish} from ${JSON.stringify(snapshot)};\nconst report=snapshot(${JSON.stringify(productRevision)});\nreport.externalVerifier=${JSON.stringify(receipt)};\ntry { currentConsumers(report); finish(report,0); } catch(error) { finish(report,error.exitCode===78?78:1,error); }\n`;
  writeFileSync(driver, program, { flag: 'wx' });
  return { ...receipt, driver, driverSha256: hash(Buffer.from(program)) };
}
