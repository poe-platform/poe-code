import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boundFile } from '../executor-v3/projection.mjs';
import { requireThat } from '../executor-v4/safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'CONSUMER-SCOPES.json')));

export function scopeDefinition(engine) {
  const scope = manifest.engines[engine];
  requireThat(scope && !['virtual-bash', 'just-bash'].includes(scope.packageName), 'CONSUMER_ENGINE', engine);
  for (const file of scope.files) boundFile(path.join(root, file.source), file);
  return scope;
}

export function wrapperEntries(engine) {
  return scopeDefinition(engine).files.map(({ source, ...entry }) => entry);
}

export function wrapperContent(engine, name) {
  const file = scopeDefinition(engine).files.find(entry => entry.path === name);
  requireThat(file, 'CONSUMER_WRAPPER', name);
  return boundFile(path.join(root, file.source), file);
}

export function authenticateConsumerScope(view) {
  const scope = scopeDefinition(view.engine);
  requireThat(view.consumerPath === scope.consumerPath, 'CONSUMER_PATH', view.consumerPath);
  for (const expected of wrapperEntries(view.engine)) {
    const actual = view.files.find(entry => entry.path === expected.path);
    requireThat(actual && JSON.stringify(actual) === JSON.stringify(expected), 'CONSUMER_SCOPE_BINDING', expected.path);
    requireThat(fs.existsSync(path.join(view.root, expected.path)), 'CONSUMER_BOUNDARY_MISSING', expected.path);
    boundFile(path.join(view.root, expected.path), expected);
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(view.root, scope.packagePath)));
  requireThat(metadata.name === scope.packageName && metadata.private === true && metadata.type === 'module', 'CONSUMER_PRIVATE_SCOPE', metadata);
  return { engine: view.engine, parentURL: pathToFileURL(path.join(view.root, scope.consumerPath)).href, packagePath: scope.packagePath, packageName: scope.packageName };
}
