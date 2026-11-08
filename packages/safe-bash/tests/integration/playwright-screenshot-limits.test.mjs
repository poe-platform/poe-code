import assert from 'node:assert/strict';
import { test } from 'node:test';

const { chromium } = await import(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright-core');
const root = process.env.SAFE_BASH_TEST_ROOT || new URL('../../dist/', import.meta.url).href;
const { createPlaywrightAdapter, createPlaywrightCli } = await import(new URL('commands/playwright/index.js', root));
const { Shell } = await import(new URL('shell/index.js', root));
const { MemoryFileSystem } = await import(new URL('fs/memory/index.js', root));

for (const scenario of [
  { name: 'small image succeeds', size: 8, maxArtifactBytes: 1024, capture: true },
  { name: 'post-measurement resize cannot enlarge capture', size: 8, maxArtifactBytes: 1024, capture: true, resize: true },
  { name: 'encoded overhead exceeds exact artifact limit', size: 8, maxArtifactBytes: 256, capture: true, error: /Artifact byte limit exceeded/ },
  { name: '2048 full page refused before capture', size: 2048, maxArtifactBytes: 1024, capture: false, error: /Screenshot pixel limit exceeded/ },
  { name: '4096 full page refused before capture', size: 4096, maxArtifactBytes: 1024, capture: false, error: /Screenshot pixel limit exceeded/ },
  { name: 'PNG raster ceiling remains below provider message cap', size: 2000, maxArtifactBytes: 16777216, capture: true },
  { name: 'JPEG raster ceiling remains below provider message cap', size: 1000, maxArtifactBytes: 16777216, capture: true, type: 'jpeg' },
]) test(`native screenshot: ${scenario.name}`, { timeout: 15000 }, async testContext => {
  const browser = await chromium.launch();
  let context;
  let captures = 0;
  let releases = 0;
  const adapter = createPlaywrightAdapter({ chromium: { async acquireBrowser() {
    return { browser: {
      isConnected: () => browser.isConnected(), on: browser.on.bind(browser), off: browser.off.bind(browser),
      async newContext() {
        context = await browser.newContext({ viewport: { width: 8, height: 8 }, deviceScaleFactor: 4 });
        await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}</style><canvas></canvas>' }));
        return context;
      },
    }, release: async () => { releases++; await browser.close(); } };
  } } });
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(createPlaywrightCli({ adapter, limits: { maxArtifactBytes: scenario.maxArtifactBytes } }).plugin);
  const run = args => shell.exec(`playwright-cli ${args}`);
  try {
    assert.equal((await run('open https://example.test/')).exitCode, 0);
    const page = context.pages()[0];
    const screenshot = page.screenshot.bind(page);
    page.screenshot = async options => {
      captures++;
      if (scenario.resize) {
        await page.setViewportSize({ width: 2048, height: 2048 });
        await page.evaluate(() => {
          const canvas = globalThis.document.querySelector('canvas');
          canvas.width = 4096; canvas.height = 4096;
        });
      }
      return screenshot(options);
    };
    await page.evaluate(size => {
      const canvas = globalThis.document.querySelector('canvas');
      canvas.width = size; canvas.height = size;
      canvas.style.display = 'block';
      const drawing = canvas.getContext('2d');
      const image = drawing.createImageData(size, size);
      let seed = 123456789;
      for (let offset = 0; offset < image.data.length; offset++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        image.data[offset] = offset % 4 === 3 ? 255 : seed >>> 24;
      }
      drawing.putImageData(image, 0, 0);
    }, scenario.size);
    const filename = `/capture.${scenario.type || 'png'}`;
    const result = await run(`screenshot --full-page --filename=${filename}`);
    assert.equal(captures, scenario.capture ? 1 : 0);
    if (scenario.error) {
      assert.equal(result.exitCode, 1, result.stderr);
      assert.match(result.stderr, scenario.error);
      await assert.rejects(fs.readFile(filename));
    } else {
      assert.equal(result.exitCode, 0, result.stderr);
      const bytes = await fs.readFile(filename);
      assert.ok(bytes.byteLength <= scenario.maxArtifactBytes);
      assert.ok(4 * Math.ceil(bytes.byteLength / 3) + 4096 < 32 * 1024 * 1024);
      testContext.diagnostic(`${scenario.type || 'png'}: ${bytes.byteLength} encoded bytes at ${scenario.size}x${scenario.size} CSS pixels`);
      if (scenario.type !== 'jpeg') {
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        assert.equal(header.getUint32(16), scenario.size);
        assert.equal(header.getUint32(20), scenario.size);
      } else assert.deepEqual([...bytes.subarray(0, 2)], [255, 216]);
    }
    assert.equal((await run('goto https://example.test/recovery')).exitCode, 0);
    assert.equal((await run('snapshot')).exitCode, 0);
  } finally { await shell.dispose(); await browser.close(); }
  assert.equal(releases, 1);
});
