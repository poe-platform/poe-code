import { build } from 'esbuild';
import type { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildNativeFixture(entry: URL) {
  const installed = process.env.SAFE_PLAYWRIGHT_INSTALLED_ROOT;
  const plugins: import('esbuild').Plugin[] = [];
  if (installed) {
    const manifest = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'));
    const companion = dirname(resolve(installed, manifest.exports['./playwright/cloudflare'].import));
    const source = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
    const provider = resolve(installed, '../../@cloudflare/playwright');
    const providerManifest = JSON.parse(await readFile(resolve(provider, 'package.json'), 'utf8'));
    plugins.push({ name: 'installed-browser-conformance', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === '@cloudflare/playwright') return { path: resolve(provider, providerManifest.exports['.'].default) };
        if (args.path === '@poe-platform/safe-bash' || args.path.startsWith('@poe-platform/safe-bash/')) {
          const route = '.' + args.path.slice('@poe-platform/safe-bash'.length);
          const exported = manifest.exports[route];
          if (!exported?.import) throw new Error('Unexported installed conformance import: ' + route);
          return { path: resolve(installed, exported.import) };
        }
        if (!args.path.startsWith('.')) return;
        const target = resolve(args.resolveDir, args.path);
        if (!target.startsWith(source + sep)) return;
        const name = target.slice(source.length + 1);
        return { path: resolve(companion, name.endsWith('.js') ? name : name.endsWith('.ts') ? name.slice(0, -3) + '.js' : name + '.js') };
      });
    } });
  }
  const result = await build({
    entryPoints: [entry.pathname], bundle: true, format: 'esm', platform: 'node',
    target: 'es2022', external: ['node:*', 'cloudflare:*', 'browser-user-code.js'], write: false, plugins,
  });
  const source = result.outputFiles[0]?.text;
  if (!source) throw new Error('Native browser fixture bundle missing');
  return source;
}

export async function disposeNativeFixture(worker: Miniflare) {
  await worker.dispose();
}
