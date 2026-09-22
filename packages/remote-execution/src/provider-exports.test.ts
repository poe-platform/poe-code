import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { build } from 'esbuild';

it.each(['rest', 'cloudflare', 'modal'])('resolves the public %s provider configuration', provider => {
  const specifier = '@poe-code/remote-execution/providers/' + provider;
  const url = execFileSync(process.execPath, ['--input-type=module', '-e', `console.log(import.meta.resolve(${JSON.stringify(specifier)}))`], { encoding: 'utf8' }).trim();
  expect(url.endsWith('/dist/providers/' + provider + '.js')).toBe(true);
});

it('keeps portable provider configurations inert and free of native SDKs', async () => {
  const result = await build({ absWorkingDir: new URL('..', import.meta.url).pathname,
    stdin: { resolveDir: new URL('..', import.meta.url).pathname, contents: `
      export { default as rest } from '@poe-code/remote-execution/providers/rest';
      export { default as cloudflare } from '@poe-code/remote-execution/providers/cloudflare';
      export { default as modal } from '@poe-code/remote-execution/providers/modal';
    ` }, bundle: true, platform: 'browser', conditions: ['workerd'], format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  expect(Object.keys(result.metafile!.inputs).filter(input => input.includes('node_modules/modal/') || input.includes('node_modules/@cloudflare/') || input.includes('native-process') || input.includes('media-server'))).toEqual([]);
  const providers = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
  expect(providers.rest.transport).toBe('https');
  expect(providers.cloudflare.transport).toBe('rpc');
  expect(providers.modal.executionClass).toBe('standard-sandbox');
});
