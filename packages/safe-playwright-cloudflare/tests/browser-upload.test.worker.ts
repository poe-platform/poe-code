import assert from 'node:assert/strict';
import type { BrowserWorker, Page } from '@cloudflare/playwright';
import { createMemoryFileSystem } from '@poe-platform/safe-bash';
import { createPlaywrightController } from '@poe-platform/safe-bash/playwright';
import { createCloudflarePlaywrightAdapter } from '../src/index.js';

export default { async fetch(_request: Request, env: { BROWSER: BrowserWorker }) {
  const controller = createPlaywrightController({ adapter: createCloudflarePlaywrightAdapter(env.BROWSER) });
  const files = new Map([
    ['/virtual/binary-é.bin', Uint8Array.of(0, 128, 255, 10, 195, 169)],
    ['/virtual/empty.dat', new Uint8Array()],
  ]);
  const fs = createMemoryFileSystem();
  await fs.mkdir('/virtual', { recursive: true });
  for (const [filename, bytes] of files) await fs.writeFile(filename, bytes);
  async function run(...args: string[]) {
    let output = '';
    await controller.run({ args, env: {}, signal: AbortSignal.timeout(10000),
      async readArtifact(filename, maxBytes) {
        const bytes = await fs.readFile(filename);
        assert.ok(bytes.byteLength <= maxBytes);
        return bytes;
      },
      async write(text) { output += text; },
    });
    return output;
  }
  try {
    await run('open');
    const page = controller.inspectSessions()[0]?.context.pages()[0] as Page | undefined;
    assert.ok(page);
    await page.setContent(`<input id="files" type="file" multiple><button onclick="document.querySelector('#files').click()">Choose files</button>`);
    const snapshot = await run('snapshot');
    const button = snapshot.split('\n').find(line => line.includes('button "Choose files"'));
    const ref = button?.match(/\[ref=(e\d+)\]/)?.[1];
    assert.ok(ref, snapshot);
    await run('click', ref);
    await run('upload', ...files.keys());
    const received = await page.evaluate(async () => Promise.all(
      Array.from(document.querySelector<HTMLInputElement>('#files')!.files!).map(async file => ({
        name: file.name,
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      })),
    ));
    return Response.json({ received });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  } finally { await controller.dispose(); }
} };
