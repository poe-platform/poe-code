import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightController } from '../../src/playwright/controller.js';
import type { PlaywrightPage } from '../../src/playwright/adapter.js';

for (const format of ['yaml', 'json'] as const) {
  for (const policy of [
    { name: 'default', config: {}, expected: 30000 },
    { name: 'explicit action', config: { timeouts: { action: 1500 } }, expected: 1500 },
    { name: 'unlimited action', config: { timeouts: { action: 0 } }, expected: 0 },
    { name: 'snapshot override', config: { timeouts: { action: 1500, snapshot: 20000 } }, expected: 20000 },
    { name: 'unlimited snapshot INI', config: 'timeouts.action=1500\ntimeouts.snapshot=0', expected: 0 },
    { name: 'SDK action limit', config: {}, limit: 2400, expected: 2400 },
    { name: 'snapshot overrides SDK action limit', config: { timeouts: { snapshot: 20000 } }, limit: 2400, expected: 20000 },
  ]) test(`${format} snapshot deadline: ${policy.name}`, async () => {
    const captures: number[] = [];
    const capture = (options?: { timeout?: number }) => {
      captures.push(options!.timeout!);
      // Model a cold native capture requiring seven seconds without sleeping.
      if (policy.name === 'default' && options!.timeout! < 7000) throw new Error('Cold snapshot deadline exceeded');
    };
    const page = {
      url: () => 'about:blank', async goto() {}, on() {}, off() {},
      async ariaSnapshot(options?: { timeout?: number }) { capture(options); return '- document'; },
      async ariaSnapshotJSON(options?: { timeout?: number }) { capture(options); return [{ role: 'document' }]; },
    } as unknown as PlaywrightPage;
    const controller = createPlaywrightController({
      ...(policy.limit === undefined ? {} : { limits: { actionTimeoutMs: policy.limit } }),
      adapter: { browsers: { chromium: { headed: false } }, async acquire() {
        return { context: { pages: () => [page], async newPage() { return page; }, async close() {}, on() {}, off() {} }, onClosed: () => () => {}, async release() {} };
      } },
    });
    const run = async (args: string[]) => {
      let output = '';
      await controller.run({ args, env: {}, signal: new AbortController().signal,
        async write(text) { output += text; },
        async readArtifact() { return new TextEncoder().encode(typeof policy.config === 'string' ? policy.config : JSON.stringify(policy.config)); },
      });
      return output;
    };
    try {
      await run(['open', '--config=' + (typeof policy.config === 'string' ? 'config.ini' : 'config.json')]);
      captures.length = 0;
      await run(['snapshot', ...(format === 'json' ? ['--json'] : [])]);
      assert.equal(captures.length, 1);
      assert.ok(policy.expected === 0 ? captures[0] === 0 : captures[0]! > policy.expected - 100 && captures[0]! <= policy.expected);
      if (format === 'yaml') {
        captures.length = 0;
        await run(['find', 'document']);
        assert.ok(policy.expected === 0 ? captures[0] === 0 : captures[0]! > policy.expected - 100 && captures[0]! <= policy.expected);
      }
      const printed = JSON.parse((await run(['--raw', 'config-print'])).trim());
      assert.equal(printed.timeouts.snapshot, policy.expected);
      if (policy.name === 'default') assert.equal(printed.timeouts.action, 5000);
    } finally { await controller.dispose(); }
  });
}
