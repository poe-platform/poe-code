import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import { root, owned, patchJson, sha256 } from './support.mjs';

const path = resolve(root, 'tests/shell-stress/invocation-closure/compare.ts');
const original = await readFile(path, 'utf8');
const originalImport = 'import { owned, save, sha256 } from "./support.js";';
assert.equal(original.split(originalImport).length, 2);
const adapted = original.replace(originalImport, `import { owned, patchJson as save, sha256 } from ${JSON.stringify(pathToFileURL(resolve(owned, 'support.mjs')).href)};`);
patchJson(`acceptance-comparison-adapter-${process.argv[6]}.json`, { helper: path, originalSha256: sha256(original), adaptedSha256: sha256(adapted), replacement: { from: originalImport, to: 'Owned evidence output adapter only; every comparison/assertion unchanged.' } });
const compiled = ts.transpileModule(adapted, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
