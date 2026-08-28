import { join, posix } from 'node:path';
import { canonical, fileDigest, requireFact, sha256, snapshot } from './primitives.mjs';

export function historicalTreeIdentity(tree) {
  const rows = [];
  const walk = suffix => {
    const children = [...Object.keys(tree.files), ...Object.keys(tree.directories).filter(Boolean)].filter(name => posix.dirname(name) === (suffix || '.')).sort();
    for (const name of children) {
      if (Object.hasOwn(tree.directories, name)) { rows.push([name, 'directory', tree.directories[name]]); walk(name); }
      else { const item = tree.files[name]; rows.push([name, item.sha256, item.bytes, item.mode]); }
    }
  };
  walk('');
  return { sha256: sha256(JSON.stringify(rows)), entries: rows.length };
}
export function authenticateToolProfile(toolchain, expected) {
  const result = {};
  for (const name of ['node', 'typescript', 'nodeTypes', 'undiciTypes']) {
    const location = join(toolchain.root, toolchain[name]);
    const actual = name === 'node' ? { sha256: fileDigest(location, 134217728).sha256 } : historicalTreeIdentity(snapshot(location));
    requireFact(actual.sha256 === expected[name].sha256 && (expected[name].entries === undefined || actual.entries === expected[name].entries), 'COPIED_TOOL_PROFILE', name);
    result[name] = { path: location, ...actual, ...(expected[name].version ? { version: expected[name].version } : {}) };
  }
  requireFact(result.nodeTypes.path.endsWith('/node_modules/@types/node') && result.undiciTypes.path.endsWith('/node_modules/undici-types'), 'TOOL_DEPENDENCY_LAYOUT');
  return result;
}
