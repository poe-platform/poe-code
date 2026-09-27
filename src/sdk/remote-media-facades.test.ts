import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Volume } from 'memfs';
import { expect, it } from 'vitest';

it.each(['media', 'remote-execution'])('exposes the %s server declarations only to Node consumers', owner => {
  const importer = fileURLToPath(new URL('./consumer.mts', import.meta.url));
  const options: ts.CompilerOptions = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const nodeDeclaration = fileURLToPath(new URL(`../../dist/${owner}-server.d.ts`, import.meta.url));
  const unavailableDeclaration = fileURLToPath(new URL('../../packages/safe-fs/dist/node-unavailable.d.ts', import.meta.url));
  const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const volume = Volume.fromJSON({
    [manifestPath]: readFileSync(manifestPath, 'utf8'),
    [nodeDeclaration]: readFileSync(new URL(`../${owner}-server.ts`, import.meta.url), 'utf8'),
    [unavailableDeclaration]: readFileSync(new URL('../../packages/safe-fs/src/node-unavailable.ts', import.meta.url), 'utf8'),
  });
  const host: ts.ModuleResolutionHost = {
    fileExists: name => volume.existsSync(name),
    readFile: name => volume.existsSync(name) ? volume.readFileSync(name, 'utf8').toString() : undefined,
  };
  const specifier = `poe-code/${owner}/server`;
  expect(ts.resolveModuleName(specifier, importer, options, host).resolvedModule?.resolvedFileName)
    .toBe(nodeDeclaration);
  for (const conditions of [['browser'], ['workerd'], ['node', 'browser'], ['node', 'workerd']]) {
    const resolved = ts.resolveModuleName(specifier, importer, { ...options, customConditions: conditions }, host).resolvedModule;
    expect(resolved?.resolvedFileName).toBe(unavailableDeclaration);
    expect(host.readFile(resolved!.resolvedFileName)!.trim()).toBe('export {};');
  }
});
