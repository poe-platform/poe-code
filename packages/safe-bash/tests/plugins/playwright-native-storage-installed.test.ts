import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { installedStorageDriver, installedStorageCloudflareHost } from './playwright-native-storage-installed-fixture.js';

const runtime = process.env.SAFE_BASH_STORAGE_RUNTIME;
const admissionPath = process.env.SAFE_BASH_STORAGE_ADMISSION;
const cloudflare = process.env.SAFE_BASH_STORAGE_CF === '1';

type State = { cookies: unknown[]; origins: { origin: string; localStorage: { name: string; value: string }[]; indexedDB?: { name: string; stores: { records: unknown[] }[] }[] }[] };
type Report = {
  baseline: { historical: boolean; sameContext: boolean; sameSelectedPage: boolean; sameTabs: boolean; sessions: string[]; state: State };
  importedCookies: unknown[]; saved: State; preserved: boolean; removed: { local: null; databases: string[] }; restored: unknown;
  indexed: State; finalSessions: string[]; activeTargets: number; ownedBrowserRetired: boolean; sessionAbsent?: boolean;
  cancellation?: { error?: string; result?: { exitCode: number }; activeTargets: number; releases: number; browserConnected: boolean };
};

async function admitInstallation() {
  const version = process.env.SAFE_BASH_STORAGE_EXPECTED_VERSION;
  const source = process.env.SAFE_BASH_STORAGE_EXPECTED_SOURCE;
  assert.ok(admissionPath && version && source && source.length === 40, 'Exact installation admission, version and source are required');
  const admission = JSON.parse(await readFile(admissionPath, 'utf8')) as { version: string; source: string; consumer: string; provenanceAndIntegrityVerified: boolean };
  assert.equal(admission.version, version);
  assert.equal(admission.source, source);
  assert.equal(admission.provenanceAndIntegrityVerified, true);
  assert.ok(admission.consumer.startsWith(dirname(admissionPath) + sep), 'Use the independently retained qualification installation');
  const consumer = admission.consumer;
  assert.equal(await realpath(consumer), consumer);
  const lockBytes = await readFile(join(consumer, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8'));
  for (const name of ['safe-bash', 'safe-fs', 'safe-js']) {
    const specifier = '@poe-platform/' + name;
    const directory = join(consumer, 'node_modules', specifier);
    assert.equal(await realpath(directory), directory);
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, specifier); assert.equal(manifest.version, version);
    const identity = lock.packages['node_modules/' + specifier];
    assert.equal(identity.version, version); assert.notEqual(identity.link, true);
    assert.equal(new URL(identity.resolved).origin, 'https://registry.npmjs.org');
    assert.ok(identity.integrity.startsWith('sha512-'));
    assert.equal(lock.packages[''].dependencies[specifier], version);
  }
  const entry = join(consumer, 'public-storage-entry.mjs');
  await writeFile(entry, "export * from '@poe-platform/safe-bash/commands/playwright';\n");
  const publicModule = await import(pathToFileURL(entry).href);
  for (const name of ['createPlaywrightCli', 'createPlaywrightAdapter', 'createPlaywrightPrivateTargetTransport', 'createPlaywrightStorageOriginPreparer']) assert.equal(typeof publicModule[name], 'function', name);
  assert.equal(publicModule.readPlaywrightStorageState, undefined, 'Qualification must not rely on a private storage reader');
  assert.equal(publicModule.replacePlaywrightStorageState, undefined, 'Cancellation must use the public command path');
  return { consumer, version, source, lockSha256: createHash('sha256').update(lockBytes).digest('hex') };
}

test(`installed-public storage replay: ${cloudflare ? 'actual Cloudflare/local workerd' : 'native Chromium'}`, { skip: !runtime || !admissionPath, timeout: 60_000 }, async context => {
  const admission = await admitInstallation();
  const out = process.env.SAFE_BASH_STORAGE_OUT;
  const executablePath = process.env.SAFE_BASH_STORAGE_CHROMIUM;
  assert.ok(out && out.startsWith('/home/') && executablePath && process.env.TMPDIR?.startsWith('/home/'));
  assert.ok(out);
  const require = createRequire(resolve(runtime!, 'package.json'));
  const origins = await Promise.all(['active', 'historical', 'imported'].map(async () => {
    const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Installed storage replay</title>'); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    context.after(() => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
  }));
  await mkdir(out, { recursive: true });
  const directory = await mkdtemp(join(out, 'installed-storage-'));
  const { build } = require('esbuild');
  const contents = cloudflare ? installedStorageDriver + installedStorageCloudflareHost + `
export default { async fetch(request, env) {
  const { origins } = await request.json(); const resource = await acquireInstalledStorageBrowser(env.BROWSER); let report; let sessionAbsent;
  try { report = await qualifyInstalledStorage(resource.browser, origins, resource.prepareStorageOrigin, resource.release); }
  finally { sessionAbsent = await resource.release(); }
  return Response.json({ ...report, sessionAbsent, ownedBrowserRetired: !resource.browser.isConnected() });
} };` : installedStorageDriver;
  const bundle = await build({ stdin: { contents, resolveDir: admission.consumer }, absWorkingDir: admission.consumer,
    nodePaths: [join(admission.consumer, 'node_modules'), resolve(runtime!, 'node_modules')], bundle: true, write: false, metafile: true,
    platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'] });
  const inputs = [];
  for (const filename of Object.keys(bundle.metafile.inputs)) {
    if (filename === '<stdin>') continue;
    const path = resolve(admission.consumer, filename);
    assert.ok(!path.includes('/packages/safe-bash/') && !path.includes('/packages/safe-fs/'), 'No checkout product source');
    if (path.includes('/node_modules/@poe-platform/')) assert.ok(path.startsWith(admission.consumer + sep), 'No tool installation can override public product artifacts');
    const stat = await lstat(path); assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(await realpath(path), path);
    inputs.push({ path, size: stat.size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
  assert.ok(inputs.some(input => input.path.startsWith(join(admission.consumer, 'node_modules/@poe-platform/safe-bash') + sep)));
  await writeFile(join(directory, 'inputs.json'), JSON.stringify({ admission, noProductOverlays: true, inputs }, null, 2));
  let report: Report;
  if (cloudflare) {
    assert.equal(require(resolve(runtime!, 'node_modules/@cloudflare/playwright/package.json')).version, '1.3.6');
    const { Miniflare } = require('miniflare');
    const miniflare = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'], unsafeEvalBinding: 'EVAL', cf: false, browserRendering: { binding: 'BROWSER' } });
    try {
      await miniflare.ready;
      const response = await miniflare.dispatchFetch('http://fixture/installed-storage', { method: 'POST', body: JSON.stringify({ origins }) });
      const text = await response.text();
      await writeFile(join(directory, 'response.json'), JSON.stringify({ status: response.status, text }, null, 2));
      assert.equal(response.status, 200, text.slice(0, 3000)); report = JSON.parse(text) as Report;
    } finally { await miniflare.dispose(); }
  } else {
    const path = join(directory, 'driver.mjs'); await writeFile(path, bundle.outputFiles[0].text);
    const { qualifyInstalledStorage } = await import(pathToFileURL(path).href);
    const browser = await require('playwright').chromium.launch({ executablePath, headless: true });
    try { report = { ...await qualifyInstalledStorage(browser, origins, undefined, () => browser.close()), ownedBrowserRetired: !browser.isConnected() }; }
    finally { await browser.close(); }
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify({ mode: 'installed-public', scope: cloudflare ? 'Actual CF1.3.6/local BROWSER, not deployed' : 'Actual native Chromium', admission, report }, null, 2));
  context.diagnostic(directory);
  assert.deepEqual(report.baseline, { historical: true, sameContext: true, sameSelectedPage: true, sameTabs: true, sessions: ['first', 'second'], state: { cookies: [], origins: [] } });
  report.saved.origins[0]!.localStorage.sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(report.saved, { cookies: report.importedCookies, origins: [{ origin: origins[2], localStorage: [{ name: 'imported', value: 'mutated' }, { name: 'intervening', value: 'current' }] }] });
  assert.equal(report.preserved, true); assert.deepEqual(report.removed, { local: null, databases: [] });
  assert.deepEqual(report.restored, { local: 'yes', nil: true, nativeNull: true, cyclic: true, missing: true, bytes: [0, 128, 255], number: '42', date: '2026-01-01T00:00:00.000Z' });
  assert.equal(report.indexed.origins.find(origin => origin.origin === origins[2])!.indexedDB![0]!.stores[0]!.records.length, 3);
  assert.deepEqual(report.finalSessions, ['first', 'second']); assert.equal(report.activeTargets, 0); assert.equal(report.ownedBrowserRetired, true);
  if (cloudflare) {
    assert.equal(report.sessionAbsent, true);
    assert.ok(report.cancellation?.error?.includes('installed-public-storage-cancel') || report.cancellation?.result?.exitCode === 130, JSON.stringify(report.cancellation));
    assert.equal(report.cancellation?.activeTargets, 0); assert.equal(report.cancellation?.releases, 1); assert.equal(report.cancellation?.browserConnected, false);
  }
});
