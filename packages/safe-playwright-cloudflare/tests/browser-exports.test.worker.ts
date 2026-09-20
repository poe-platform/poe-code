import assert from 'node:assert/strict';
import { createCloudflarePlaywrightAdapter } from '../src/index.js';
import { generateBrowserActionCode } from '../src/browser-codegen.js';
import { createPlaywrightController } from '@poe-platform/safe-bash/playwright';

export default { async fetch() {
  const adapter = createCloudflarePlaywrightAdapter();
  assert.deepEqual(adapter.browsers, {chromium: {headed: false}});
  const cli = createPlaywrightController({adapter});
  let output = '';
  await cli.run({args: ['--help'], env: {}, signal: new AbortController().signal, async write(text) { output += text; }});
  assert.ok(output.includes('run-code') && output.includes('state-load'));
  assert.equal(output.includes('Cloudflare'), false);
  await cli.dispose();
  const action = {name: 'click' as const, selector: 'internal:role=button[name="Save"s]', button: 'left' as const, modifiers: 0, clickCount: 1};
  for (const [language, expected] of [
    ['typescript', "await page.getByRole('button', { name: 'Save', exact: true }).click();"],
    ['python', 'page.get_by_role("button", name="Save", exact=True).click()'],
    ['java', 'page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save").setExact(true)).click();'],
    ['csharp', 'await page.GetByRole(AriaRole.Button, new() { Name = "Save", Exact = true }).ClickAsync();'],
  ] as const) assert.equal(generateBrowserActionCode({language, action}), expected);
  return Response.json({ok: true});
} };
