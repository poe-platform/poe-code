import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [filename, expected] = process.argv.slice(2), bytes = fs.readFileSync(filename); assert.equal(hash(bytes), expected);
const manifest = JSON.parse(bytes); assert.equal(process.execPath, manifest.node.path); assert.equal(hash(fs.readFileSync(process.execPath)), manifest.node.sha256);
console.log(JSON.stringify({ kind: 'birth', pid: process.pid, ppid: process.ppid, execPath: process.execPath, version: process.version }));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('node:')) { assert.ok(manifest.builtins.includes(specifier)); return next(specifier, context); }
    assert.ok(specifier.startsWith('.') || specifier.startsWith('file:'));
    const target = new URL(specifier, context.parentURL); assert.equal(target.search + target.hash, ''); assert.equal(target.protocol, 'file:'); assert.ok(Object.hasOwn(manifest.modules, fileURLToPath(target)), 'only pure sealed helper modules'); return { url: target.href, shortCircuit: true };
  },
  load(url, context, next) {
    if (url.startsWith('node:')) { assert.ok(manifest.builtins.includes(url)); return next(url, context); }
    const filename = fileURLToPath(url), binding = manifest.modules[filename]; assert.ok(binding); assert.equal(fs.realpathSync(filename), filename);
    const source = fs.readFileSync(filename); assert.equal(hash(source), binding.sha256); assert.equal(source.length, binding.bytes);
    console.log(JSON.stringify({ kind: 'load', path: filename, sha256: hash(source), bytes: source.length })); return { format: 'module', source, shortCircuit: true };
  },
});
await import(pathToFileURL(manifest.entry).href);
