import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), temporary = process.argv[2], output = process.argv[3];
assert.ok(temporary && output);
const { createBuiltPackageBinding, assertBuiltConsumerResolution } = await import(pathToFileURL(join(root, 'scripts/typecheck-consumers.mjs')));
const binding = createBuiltPackageBinding(root);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { cases: [], declarations: binding.declarations.size, metadataSha256: binding.metadataSha256 };
const defaultSource = `import { Shell, type CommandDefinition } from 'virtual-bash';
import { type CommandContext } from 'virtual-bash/contracts';
import { type CommandInvokeOptions } from 'virtual-bash/contracts/command';
import { readFileSync } from 'node:fs';
void [Shell, readFileSync]; let definitions: CommandDefinition[] = []; let context: CommandContext | undefined; let options: CommandInvokeOptions = {}; void [definitions, context, options];\n`;
const cases = [
  { name: 'root-subpath-wildcard-and-external-node-types', expected: 'accept' },
  { name: 'explicit-paths-to-authenticated-export', expected: 'accept', paths: installed => ({ 'virtual-bash/contracts': [join(installed, 'dist/contracts/index.d.ts')] }) },
  { name: 'same-package-wrong-export', expected: /wrong candidate export/u, paths: installed => ({ 'virtual-bash/contracts': [join(installed, 'dist/contracts/command.d.ts')] }) },
  { name: 'undeclared-public-subpath', expected: /no candidate types export/u, source: `import { type CommandContext } from 'virtual-bash/not-exported'; const context: CommandContext | undefined = undefined; void context;\n`, paths: installed => ({ 'virtual-bash/not-exported': [join(installed, 'dist/contracts/index.d.ts')] }) },
  { name: 'foreign-identical-declaration', expected: /foreign candidate declaration/u, paths: (_installed, decoy) => ({ 'virtual-bash/contracts': [join(decoy, 'contracts/index.d.ts')] }) },
  { name: 'changed-candidate-declaration-after-compile', expected: /declaration bytes or file set changed/u, after: installed => writeFileSync(join(installed, 'dist/contracts/command.d.ts'), readFileSync(join(installed, 'dist/contracts/command.d.ts'), 'utf8') + '\nexport declare const unexpectedAfterCompilation: number;\n') },
  { name: 'changed-package-metadata-after-compile', expected: /package metadata changed/u, after: installed => { const path = join(installed, 'package.json'); const metadata = JSON.parse(readFileSync(path)); metadata.version = '99.0.0'; writeFileSync(path, JSON.stringify(metadata)); } },
  { name: 'deleted-unimported-declaration-after-compile', expected: /declaration bytes or file set changed/u, after: installed => rmSync(join(installed, 'dist/commands/time-env/printenv.d.ts')) },
  { name: 'identical-declaration-symlink-after-compile', expected: /regular files/u, after: (installed, decoy) => { const path = join(installed, 'dist/contracts/command.d.ts'); rmSync(path); symlinkSync(join(decoy, 'contracts/command.d.ts'), path); } },
  { name: 'dist-directory-symlink-after-compile', expected: /dist must not redirect/u, after: (installed, decoy) => { rmSync(join(installed, 'dist'), { recursive: true }); symlinkSync(decoy, join(installed, 'dist'), 'dir'); } },
  { name: 'missing-real-public-import', expectedCompiler: /TS2305/u, source: `import { independentMissingExport } from 'virtual-bash/contracts'; void independentMissingExport;\n` },
];
for (const specification of cases) {
  const current = { name: specification.name, status: 'pending' }; report.cases.push(current);
  try {
    const consumer = join(temporary, specification.name), installed = join(consumer, 'node_modules/virtual-bash'), decoy = join(consumer, 'decoy-dist');
    mkdirSync(installed, { recursive: true }); cpSync(join(root, 'dist'), join(installed, 'dist'), { recursive: true });
    copyFileSync(join(root, 'package.json'), join(installed, 'package.json')); cpSync(join(root, 'dist'), decoy, { recursive: true });
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    writeFileSync(join(consumer, 'consumer.mts'), specification.source ?? defaultSource);
    const config = { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, exactOptionalPropertyTypes: true, typeRoots: [join(root, 'node_modules/@types')], types: ['node'], paths: specification.paths?.(installed, decoy) }, files: ['consumer.mts'] };
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(config));
    const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json'), '--traceResolution'], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    Object.assign(current, { compiler: result.status, stdout: result.stdout, stderr: result.stderr, source: specification.source ?? defaultSource, config });
    if (specification.expectedCompiler) { assert.equal(result.status, 2); assert.match(result.stdout, specification.expectedCompiler); }
    else {
      assert.equal(result.status, 0);
      specification.after?.(installed, decoy);
      let error;
      try { assertBuiltConsumerResolution(result.stdout, consumer, root, binding); } catch (caught) { error = caught; }
      current.guardError = error?.message;
      if (specification.expected === 'accept') assert.equal(error, undefined);
      else { assert.ok(error); assert.match(error.message, specification.expected); }
    }
    current.status = 'pass';
  } catch (error) { current.status = 'fail'; current.error = error.stack; }
}
report.rootDeclarationHashesUnchanged = [...binding.declarations].every(([path, expected]) => existsSync(join(root, path)) && digest(readFileSync(join(root, path))) === expected);
assert.equal(report.rootDeclarationHashesUnchanged, true);
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ cases: report.cases.map(({ name, status, guardError, error }) => ({ name, status, guardError, error })), declarations: report.declarations }));
process.exitCode = report.cases.some(current => current.status !== 'pass') ? 1 : 0;
