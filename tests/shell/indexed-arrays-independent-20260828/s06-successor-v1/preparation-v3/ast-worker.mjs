import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { digest, census, tarInventory } from './boundary.mjs';
import { captureAstCases } from './ast-core.mjs';

const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
try {
  const [manifestFile, expected] = process.argv.slice(2), raw = fs.readFileSync(manifestFile); assert.equal(digest(raw), expected);
  const manifest = JSON.parse(raw); assert.equal(manifest.role, 'old-c7-public-AST-only');
  assert.equal(manifest.packageSha256, '0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26');
  assert.equal(digest(fs.readFileSync(manifest.packageTar)), manifest.packageSha256);
  assert.deepEqual(census(manifest.appRoot), manifest.entries);
  const packageRoot = path.join(manifest.appRoot, 'node_modules/virtual-bash');
  assert.deepEqual(Object.fromEntries(Object.entries(census(packageRoot)).filter(([, entry]) => !entry.directory)), tarInventory(fs.readFileSync(manifest.packageTar)));
  assert.equal(process.execPath, manifest.node.path); assert.equal(process.version, manifest.node.version); assert.equal(digest(fs.readFileSync(process.execPath)), manifest.node.sha256);
  const loads = new Map();
  registerHooks({ load(url, context, next) {
    if (url.startsWith('node:')) return next(url, context);
    const filename = fileURLToPath(url), relative = path.relative(manifest.appRoot, filename), entry = manifest.entries[relative];
    assert.ok(!relative.startsWith('../') && entry && !entry.directory); assert.equal(fs.realpathSync(filename), filename); assert.equal(digest(fs.readFileSync(filename)), entry.sha256);
    const result = next(url, context); assert.ok(result.source !== null && result.source !== undefined); assert.equal(digest(Buffer.from(result.source)), entry.sha256);
    loads.set(filename, entry.sha256); emit({ load: { path: filename, sha256: entry.sha256 } }); return result;
  } });
  const api = await import('virtual-bash'); assert.equal(loads.get(path.join(packageRoot, 'dist/index.js')), manifest.entries['node_modules/virtual-bash/dist/index.js'].sha256);
  const cases = JSON.parse(fs.readFileSync(path.join(manifest.appRoot, 'AST-COMPAT.json'))).cases;
  assert.equal(cases.length, 4);
  for (const row of captureAstCases(api, cases)) emit({ astBaseline: row });
  assert.deepEqual(census(manifest.appRoot), manifest.entries); emit({ summary: { baselineAst: 4 } });
} catch (error) { emit({ diagnostic: String(error?.stack ?? error) }); process.exitCode = 78; }
