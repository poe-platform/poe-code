import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it.each(['media', 'remote-execution'])('exposes the %s server declarations only to Node consumers', owner => {
  const importer = fileURLToPath(new URL('./consumer.mts', import.meta.url));
  const options: ts.CompilerOptions = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const specifier = `poe-code/${owner}/server`;
  expect(ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName)
    .toBe(fileURLToPath(new URL(`../../dist/${owner}-server.d.ts`, import.meta.url)));
  for (const conditions of [['browser'], ['workerd'], ['node', 'browser'], ['node', 'workerd']]) {
    const resolved = ts.resolveModuleName(specifier, importer, { ...options, customConditions: conditions }, ts.sys).resolvedModule;
    expect(resolved?.resolvedFileName).toBe(fileURLToPath(new URL('../../packages/safe-fs/dist/node-unavailable.d.ts', import.meta.url)));
    expect(readFileSync(resolved!.resolvedFileName, 'utf8').trim()).toBe('export {};');
  }
});
