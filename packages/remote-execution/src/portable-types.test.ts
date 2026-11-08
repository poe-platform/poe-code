import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps portable emitted declarations free of Node module imports', () => {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: ['workerd', 'browser'],
  };
  const pending = [fileURLToPath(new URL('../dist/index.d.ts', import.meta.url))];
  const visited = new Set<string>();
  const nodeImports: string[] = [];
  while (pending.length) {
    const filename = pending.pop()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    const source = ts.preProcessFile(readFileSync(filename, 'utf8'), true, true);
    for (const imported of source.importedFiles) {
      if (imported.fileName.startsWith('node:')) {
        nodeImports.push(imported.fileName);
        continue;
      }
      const resolved = ts.resolveModuleName(imported.fileName, filename, options, ts.sys).resolvedModule;
      if (resolved) pending.push(resolved.resolvedFileName);
    }
  }
  expect(visited.size).toBeGreaterThan(1);
  expect(nodeImports).toEqual([]);
});
