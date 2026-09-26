import assert from 'node:assert/strict';
import * as native from 'node:fs/promises';
import { RealFileSystem } from '@poe-platform/safe-fs/fs/real';
import { createPlaywrightController } from '@poe-platform/safe-bash/playwright';
import { createCloudflarePlaywrightAdapter } from '@poe-platform/safe-bash/playwright/cloudflare';

// Every route is a separate Worker fetch forwarded to this same retained DO.
export class ArchiveProof {
  constructor(_context, env) {
    this.filesystem = new RealFileSystem({ root: '/' });
    const adapter = createCloudflarePlaywrightAdapter(env.BROWSER, undefined, undefined, {
      artifactFileSystem: this.filesystem, traceCapture: 'archive',
    });
    this.artifacts = [];
    this.output = '';
    this.sequence = 0;
    this.controller = createPlaywrightController({
      adapter: { ...adapter, acquire: async options => { this.lease = await adapter.acquire(options); return this.lease; } },
      limits: { maxArtifactBytes: 256 * 1024 },
    });
  }
  async run(args) {
    await this.controller.run({ args, env: {}, signal: new AbortController().signal,
      write: async text => { this.output += text; },
      writeArtifact: async (bytes, filename) => { this.artifacts.push({ filename, bytes: new Uint8Array(bytes) }); },
    });
  }
  async privateDirectories() {
    return (await native.readdir('/tmp')).filter(name => name.startsWith('poe-browser-artifact-')).sort();
  }
  async fetch(request) {
    const route = new URL(request.url).pathname;
    this.sequence++;
    try {
      if (route === '/start') {
        this.before = await this.privateDirectories();
        await this.run(['open']);
        assert.ok(this.lease);
        assert.equal(this.lease.captureTrace, undefined);
        assert.equal(typeof this.lease.captureArtifact, 'function');
        await this.run(['tracing-start']);
      } else if (route === '/navigate') {
        const page = this.lease.context.pages()[0];
        await page.setContent('<title>Workerd archive proof</title><button id="archive-proof">Recorded native action</button>');
        await page.locator('#archive-proof').click();
      } else if (route === '/stop') {
        await this.run(['tracing-stop']);
        const zips = this.artifacts.filter(artifact => artifact.filename?.endsWith('.zip'));
        assert.equal(zips.length, 1);
        assert.ok(this.output.includes(zips[0].filename));
        const archive = zips[0].bytes;
        assert.ok(archive.byteLength > 22 && archive.byteLength <= 256 * 1024);
        assert.deepEqual(await this.privateDirectories(), this.before);
        return Response.json({ ok: true, sequence: this.sequence, archive: Buffer.from(archive).toString('base64') });
      } else if (route === '/overflow-start') {
        await this.lease.context.tracing.start({ screenshots: true, snapshots: true });
      } else if (route === '/overflow-navigate') {
        await this.lease.context.pages()[0].locator('#archive-proof').click();
      } else if (route === '/overflow-stop') {
        await assert.rejects(this.lease.captureArtifact(path => this.lease.context.tracing.stop({ path }), {
          signal: new AbortController().signal, maxBytes: 1, extension: 'zip',
        }), error => error.message.includes('byte limit'));
        assert.deepEqual(await this.privateDirectories(), this.before);
      } else if (route === '/failed-producer') {
        await assert.rejects(this.lease.captureArtifact(async path => {
          await native.writeFile(path, 'partial');
          throw new Error('native producer failed');
        }, { signal: new AbortController().signal, maxBytes: 1024, extension: 'zip' }), error => error.message === 'native producer failed');
        assert.deepEqual(await this.privateDirectories(), this.before);
      } else if (route === '/dispose') {
        await this.controller.dispose();
        assert.deepEqual(await this.privateDirectories(), this.before);
      } else throw new Error('Unknown archive proof route');
      return Response.json({ ok: true, sequence: this.sequence });
    } catch (error) {
      return Response.json({ error: error.stack ?? String(error), route, sequence: this.sequence }, { status: 500 });
    }
  }
}
export default { async fetch(request, env) {
  return env.ARCHIVE_PROOF.getByName('retained-native-browser').fetch(request);
} };
