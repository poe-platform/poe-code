import assert from 'node:assert/strict';
import type { BrowserWorker } from '@cloudflare/playwright';
import { createCloudflarePlaywrightAdapter } from '../src/index.js';

export default { async fetch(_request: Request, env: { BROWSER: BrowserWorker }) {
  const lease = await createCloudflarePlaywrightAdapter(env.BROWSER).acquire({
    acquisitionId: 'screenshot', session: 'screenshot', browser: 'chromium', headless: true,
    signal: new AbortController().signal,
  });
  const page = await lease.context.newPage();
  try {
    await page.setContent('<body style="margin:0"><canvas width="1024" height="2500"></canvas><input style="caret-color:red"></body>');
    const bytes = await page.screenshot!({ type: 'png', fullPage: true, timeout: 5000 });
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(data.getUint32(16), 1280);
    assert.ok(data.getUint32(20) >= 2500);
    assert.equal(await page.locator('input').evaluate((input: HTMLElement) => input.style.getPropertyValue('caret-color')), 'red');
    return Response.json({ ok: true });
  } finally {
    await lease.release();
    assert.equal(page.isClosed(), true);
  }
} };
