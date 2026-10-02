import { build } from 'esbuild';
import type { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildNativeFixture(entry: URL, conditions?: string[]) {
  const installed = process.env.SAFE_PLAYWRIGHT_INSTALLED_ROOT;
  const plugins: import('esbuild').Plugin[] = [];
  if (installed) {
    const manifest = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'));
    const companion = dirname(resolve(installed, manifest.exports['./playwright/cloudflare'].import));
    const source = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
    plugins.push({ name: 'installed-browser-conformance', setup(builder) {
      builder.onResolve({ filter: /.*/ }, async args => {
        if (args.pluginData?.installedConformance) return;
        const specifier = args.path === '@poe-code/safe-fs' || args.path.startsWith('@poe-code/safe-fs/')
          ? '@poe-platform/safe-fs' + args.path.slice('@poe-code/safe-fs'.length) : args.path;
        if (specifier === '@cloudflare/playwright' || specifier === '@poe-platform/safe-bash' || specifier.startsWith('@poe-platform/safe-bash/')
          || specifier === '@poe-platform/safe-fs' || specifier.startsWith('@poe-platform/safe-fs/')) {
          // Let the consumer's actual export map select workerd/browser/import.
          return builder.resolve(specifier, { kind: args.kind, resolveDir: installed, pluginData: { installedConformance: true } });
        }
        if (!args.path.startsWith('.')) return;
        const target = resolve(args.resolveDir, args.path);
        if (!target.startsWith(source + sep)) return;
        const name = target.slice(source.length + 1);
        if (name === 'index.js' || name === 'index.ts')
          return builder.resolve('@poe-platform/safe-bash/playwright/cloudflare', {
            kind: args.kind, resolveDir: installed, pluginData: { installedConformance: true },
          });
        return { path: resolve(companion, name.endsWith('.js') ? name : name.endsWith('.ts') ? name.slice(0, -3) + '.js' : name + '.js') };
      });
    } });
  }
  const result = await build({
    entryPoints: [entry.pathname], bundle: true, format: 'esm', platform: 'node',
    // Workspace path aliases can mix source and built runtime class identities.
    // Resolve dependencies consistently through their package exports instead.
    tsconfigRaw: { compilerOptions: {} },
    target: 'es2022', external: ['node:*', 'cloudflare:*', 'browser-user-code.js'], write: false, metafile: true, plugins,
    conditions,
  });
  if (conditions?.some(condition => condition === 'workerd' || condition === 'browser')) {
    const nodeImports = Object.values(result.metafile.outputs).flatMap(output => output.imports)
      .filter(edge => edge.external && (edge.path.startsWith('node:') || builtinModules.includes(edge.path)));
    if (nodeImports.length) throw new Error('Portable browser fixture imports Node builtins: ' + nodeImports.map(edge => edge.path).join(', '));
  }
  const source = result.outputFiles[0]?.text;
  if (!source) throw new Error('Native browser fixture bundle missing');
  return source;
}

export async function disposeNativeFixture(worker: Miniflare) {
  await worker.dispose();
}
