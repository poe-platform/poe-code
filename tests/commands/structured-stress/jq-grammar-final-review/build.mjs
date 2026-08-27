import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { directory, digest, root, snapshot } from './common.mjs';
import { inventory } from './preservation.mjs';

export async function build() {
  const before = snapshot();
  const derivedBefore = Object.fromEntries(Object.entries(inventory()).filter(([path]) => path.startsWith('dist/')));
  const config = ts.readConfigFile(resolve(root, 'tsconfig.build.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const outputDirectory = resolve(directory, 'memory-only');
  const options = { ...parsed.options, outDir: outputDirectory };
  const emitted = new Map();
  const host = ts.createCompilerHost(options);
  host.writeFile = (filename, text) => emitted.set(pathToFileURL(filename).href, text);
  const program = ts.createProgram(parsed.fileNames, options, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const result = program.emit();
  diagnostics.push(...result.diagnostics);
  const diagnosticText = ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: filename => filename, getNewLine: () => '\n' });
  assert.equal(diagnostics.length, 0, diagnosticText);
  assert.equal(result.emitSkipped, false);
  const loaded = [];
  const sourcePrefix = pathToFileURL(`${root}/src/`).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') || specifier.startsWith('file:')) {
        const url = new URL(specifier, context.parentURL ?? pathToFileURL(`${root}/`).href).href;
        assert.ok(!url.startsWith(sourcePrefix), `compiled phase must not import source: ${url}`);
        if (emitted.has(url)) return { url, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      assert.ok(!url.startsWith(sourcePrefix), `compiled phase must not load source: ${url}`);
      if (emitted.has(url)) {
        loaded.push(relative(outputDirectory, fileURLToPathSafe(url)));
        return { format: 'module', source: emitted.get(url), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  const api = await import(pathToFileURL(resolve(outputDirectory, 'index.js')).href);
  const derivedAfter = Object.fromEntries(Object.entries(inventory()).filter(([path]) => path.startsWith('dist/')));
  assert.deepEqual(derivedAfter, derivedBefore, 'derived output stable during bounded final in-memory build');
  return { api, hooks, record: { before, afterBuild: snapshot(), derivedOutputStable: true, derivedFiles: Object.keys(derivedAfter).length, derivedSha256: digest(JSON.stringify(derivedAfter)), compilerVersion: ts.version, nodeVersion: process.version,
    method: 'Actual tsconfig.build.json; only outDir changed; writeFile intercepted for all outputs; emitted root ESM imported through synchronous hooks. Source runtime imports forbidden. tsx only handles immutable test helpers, not product modules. No dist or filesystem build output.',
    diagnostics: diagnosticText, emittedFiles: emitted.size, emitted: Object.fromEntries([...emitted].map(([url, text]) => [relative(outputDirectory, fileURLToPathSafe(url)), digest(text)])), loaded } };
}

function fileURLToPathSafe(url) { return new URL(url).pathname; }
