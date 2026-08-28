import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [filename, expected, entry, mode] = process.argv.slice(2);
const bytes = fs.readFileSync(filename); assert.equal(hash(bytes), expected);
const manifest = JSON.parse(bytes);
assert.equal(process.execPath, manifest.node.path); assert.equal(process.version, manifest.node.version);
assert.equal(hash(fs.readFileSync(process.execPath)), manifest.node.sha256);
assert.ok(['worker.mjs', 'counter.mjs'].includes(entry));
assert.ok(['synthetic', 'pilot'].includes(mode));
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
emit({ kind: 'independent-birth', pid: process.pid, ppid: process.ppid, execPath: process.execPath, version: process.version, binarySha256: manifest.node.sha256 });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('node:')) { assert.ok(manifest.builtins.includes(specifier)); return next(specifier, context); }
    assert.ok(specifier.startsWith('.') || specifier.startsWith('file:'), 'no ambient/bare/network fallback');
    const target = new URL(specifier, context.parentURL);
    assert.equal(target.protocol, 'file:'); assert.equal(target.search, ''); assert.equal(target.hash, '');
    assert.ok(Object.hasOwn(manifest.files, fileURLToPath(target)), 'unsealed module');
    return { url: target.href, shortCircuit: true };
  },
  load(url, context, next) {
    if (url.startsWith('node:')) { assert.ok(manifest.builtins.includes(url)); emit({ kind: 'independent-builtin', url }); return next(url, context); }
    const absolute = fileURLToPath(url), binding = manifest.files[absolute]; assert.ok(binding);
    assert.equal(fs.realpathSync(absolute), absolute); const stat = fs.lstatSync(absolute); assert.ok(stat.isFile() && !stat.isSymbolicLink());
    const source = fs.readFileSync(absolute); assert.equal(source.length, binding.bytes); assert.equal(hash(source), binding.sha256); assert.equal(stat.mode & 0o777, binding.mode);
    emit({ kind: 'independent-load', path: absolute, sha256: hash(source), bytes: source.length, role: binding.role });
    return { format: 'module', source, shortCircuit: true };
  },
});
const module = await import(pathToFileURL(manifest.root + '/' + entry).href);
if (mode === 'pilot') await module.run();
