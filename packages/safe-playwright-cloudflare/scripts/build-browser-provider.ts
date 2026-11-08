import { readFile, writeFile } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { preserveBrowserPolling } from './build-browser-provider-evaluation.js';

/** Compile the pinned provider with JavaScript browser implementations. No
 * globals or installed SDK files are modified, and no Node import escapes. */
export async function buildBrowserProvider(): Promise<void> {
  const require = createRequire(import.meta.url);
  const directory = dirname(fileURLToPath(import.meta.url));
  const provider = require.resolve('@cloudflare/playwright');
  const metadata = JSON.parse(await readFile(join(dirname(provider), '../package.json'), 'utf8'));
  if (metadata.version !== '1.3.6') throw new Error('Qualify the portable provider before upgrading Playwright');
  const polyfills = join(dirname(require.resolve('@jspm/core/nodelibs/buffer')), '../browser');
  const transport = join(dirname(provider), 'cloudflare/webSocketTransport.js');
  const frames = join(dirname(provider), 'playwright-core/src/server/frames.js');
  const snapshotter = join(dirname(provider), 'playwright-core/src/server/trace/recorder/snapshotterInjected.js');
  const builtins = new Set(builtinModules.map(name => name.startsWith('node:') ? name.slice(5) : name));
  // Select the host adapter at build time only. The plugin below replaces its
  // native filesystem imports with the provider's private in-memory filesystem;
  // the public safe-fs Node entrypoint stays unavailable to portable consumers.
  const result = await build({
    stdin: {
      contents: `export { acquire, connect } from ${JSON.stringify(provider)};
        import { Buffer } from ${JSON.stringify(join(polyfills, 'buffer.js'))};
        import { fs } from "memfs";
        import { RealFileSystem } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@poe-code/safe-fs/fs/real")))};
        fs.mkdirSync("/tmp", { recursive: true });
        export const artifactFileSystem = new RealFileSystem({ root: "/" });
        export function prepareFileBytes(bytes) { return Buffer.from(bytes); }`,
      resolveDir: directory,
    },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    conditions: ['workerd'],
    // Registry metadata is unreachable for Cloudflare browser launching, but
    // its initializer still selects a POSIX cache pathname.
    define: { 'process.platform': '"linux"' },
    inject: ['portable-provider-globals'], external: ['cloudflare:*'],
    // The provider serializes error constructor names across its protocol.
    minify: true, keepNames: true, legalComments: 'inline', metafile: true,
    plugins: [{ name: 'portable-provider', setup(builder) {
      builder.onLoad({ filter: /frames\.js$/ }, async args => {
        if (args.path !== frames) return;
        return { contents: preserveBrowserPolling(await readFile(args.path, 'utf8')), loader: 'js' };
      });
      builder.onLoad({ filter: /snapshotterInjected\.js$/ }, async args => {
        if (args.path !== snapshotter) return;
        const source = ts.createSourceFile(args.path, await readFile(args.path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const streamer = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'frameSnapshotStreamer');
        if (!streamer || source.statements.length !== 2) throw new Error('Pinned provider snapshot injection changed; qualify its source');
        // Playwright interpolates this function into a page script. Keep it as
        // source data so minification cannot introduce out-of-scope name helpers.
        return { contents: `export const frameSnapshotStreamer = ${JSON.stringify(streamer.getText(source))};`, loader: 'js' };
      });
      builder.onLoad({ filter: /index\.js$/ }, async args => {
        if (args.path !== provider) return;
        const source = ts.createSourceFile(args.path, await readFile(args.path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        let endpoints = 0;
        const result = ts.transform(source, [context => root => {
          const visit: ts.Visitor = node => {
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL'
              && node.arguments?.length === 1 && ts.isIdentifier(node.arguments[0]!) && node.arguments[0]!.text === 'WS_FAKE_HOST') {
              endpoints++;
              return context.factory.updateNewExpression(node, node.expression, node.typeArguments,
                [context.factory.createPropertyAccessExpression(context.factory.createIdentifier('transport'), 'endpoint')]);
            }
            return ts.visitEachChild(node, visit, context);
          };
          return ts.visitNode(root, visit) as ts.SourceFile;
        }]);
        try {
          if (endpoints !== 1) throw new Error('Pinned provider handshake changed; qualify endpoint binding');
          return { contents: ts.createPrinter().printFile(result.transformed[0]!), loader: 'js' };
        } finally { result.dispose(); }
      });
      builder.onResolve({ filter: /webSocketTransport\.js$/ }, args => {
        if (join(args.resolveDir, args.path) === transport)
          return { path: join(directory, 'portable-provider/transport.ts') };
      });
      builder.onResolve({ filter: /^(node:)?async_hooks$/ }, () => ({ path: join(directory, 'portable-provider/zones.ts') }));
      builder.onResolve({ filter: /^(node:)?https?$/ }, () => ({ path: join(directory, 'portable-provider/http.ts') }));
      builder.onResolve({ filter: /^(node:)?fs$/ }, () => ({ path: require.resolve('memfs') }));
      builder.onResolve({ filter: /^(node:)?fs\/promises$/ }, () => ({ path: 'filesystem', namespace: 'portable-provider' }));
      builder.onResolve({ filter: /^(node:)?util$/ }, () => ({ path: 'util', namespace: 'portable-provider' }));
      builder.onResolve({ filter: /.*/ }, args => {
        const name = args.path.startsWith('node:') ? args.path.slice(5) : args.path;
        if (builtins.has(name)) return { path: join(polyfills, name + '.js') };
      });
      builder.onResolve({ filter: /^portable-provider-globals$/ }, () => ({ path: 'globals', namespace: 'portable-provider' }));
      builder.onLoad({ filter: /.*/, namespace: 'portable-provider' }, args => ({
        contents: args.path === 'util' ? `export * from ${JSON.stringify(join(polyfills, 'util.js'))};
          export { default } from ${JSON.stringify(join(polyfills, 'util.js'))};
          import os from ${JSON.stringify(join(polyfills, 'os.js'))};
          export function getSystemErrorName(errno) {
            for (const [name, value] of Object.entries(os.constants.errno)) if (-Math.abs(value) === errno) return name;
            throw new RangeError('Unknown system error');
          }` : args.path === 'filesystem' ? `import { fs } from "memfs";
          export default fs.promises;
          export const { access, appendFile, chmod, copyFile, cp, lstat, mkdir, open, opendir, readdir, readFile,
            readlink, realpath, rename, rm, rmdir, stat, symlink, link, truncate, unlink, utimes, writeFile } = fs.promises;`
          : `export { Buffer } from ${JSON.stringify(join(polyfills, 'buffer.js'))};
          export { default as process } from ${JSON.stringify(join(polyfills, 'process.js'))};
          export { setImmediate, clearImmediate } from ${JSON.stringify(join(polyfills, 'timers.js'))};`,
        loader: 'js', resolveDir: directory,
      }));
    } }],
  });
  const external = Object.values(result.metafile!.outputs).flatMap(output => output.imports).filter(entry => entry.external);
  if (external.some(entry => entry.path !== 'cloudflare:workers')) throw new Error('Unexpected portable provider runtime imports: ' + external.map(entry => entry.path).join(', '));
  await writeFile(join(directory, '../src/browser-provider.generated.js'), result.outputFiles[0]!.text);
}
