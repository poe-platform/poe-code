import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlaywrightAbilityRequest } from './playwright/abilities.js';
import { createPlaywrightController, type PlaywrightControllerOptions } from './playwright/controller.js';

const textLimit = 65536;
async function screenshot(size: number, outputLimit?: number) {
  const noop = () => {};
  const page = { url: () => 'https://owned.invalid/', title: async () => 'Owned', isClosed: () => false,
    on: noop, off: noop, evaluate: async () => ({ width: 1024, height: 768 }), screenshot: async () => new Uint8Array(size) };
  const context = { pages: () => [page], newPage: async () => page, close: async () => {}, on: noop, off: noop };
  const lease = { context, release: async () => {}, onClosed: () => noop };
  const controller = createPlaywrightController({ adapter: { acquire: async () => lease }, limits: {
    maxCommandBytes: textLimit, maxArtifactBytes: 8 * 1024 * 1024,
    ...(outputLimit === undefined ? {} : { maxOutputArtifactBytes: outputLimit }),
  } } as unknown as PlaywrightControllerOptions);
  const sizes: number[] = [];
  try {
    await controller.restoreSession({ name: 'owned', acquire: async () => ({ lease, selectedPage: page }) } as never);
    await controller.run({ args: ['-s=owned', 'screenshot'], env: {}, signal: AbortSignal.timeout(3000),
      write: async () => {}, writeArtifact: async bytes => { sizes.push(bytes.byteLength); } });
    return sizes;
  } finally { await controller.dispose(); }
}

test('oversized screenshot uses independent output artifact budget', async () => {
  assert.deepEqual(await screenshot(textLimit + 1, 9 * 1024 * 1024), [textLimit + 1]);
});
test('omitted output artifact budget preserves shared limit', async () => {
  await assert.rejects(screenshot(textLimit + 1), /command byte limit exceeded/);
});
test('single artifact limit remains enforced', async () => {
  await assert.rejects(screenshot(8 * 1024 * 1024 + 1, 9 * 1024 * 1024), /Artifact byte limit exceeded/);
});

async function ability(execute: (request: PlaywrightAbilityRequest) => Promise<void>, limits: Record<string, number> = { maxOutputArtifactBytes: 100000 }) {
  const controller = createPlaywrightController({ limits: { maxCommandBytes: textLimit, maxArtifactBytes: 8 * 1024 * 1024, ...limits },
    abilities: { screenshot: { execute } } });
  let textBytes = 0;
  const artifacts: number[] = [];
  try {
    await controller.run({ args: ['screenshot'], env: {}, signal: AbortSignal.timeout(3000),
      write: async text => { textBytes += new TextEncoder().encode(text).byteLength; },
      writeArtifact: async bytes => { artifacts.push(bytes.byteLength); },
      readArtifact: async (_filename, maxBytes) => { assert.ok(maxBytes <= textLimit); return new Uint8Array(textLimit + 1); } });
    return { textBytes, artifacts };
  } finally { await controller.dispose(); }
}
test('custom ability artifact and text outputs have separate budgets', async () => {
  assert.deepEqual(await ability(async r => { await r.writeArtifact(new Uint8Array(70000)); await r.write('x'.repeat(textLimit)); }),
    { textBytes: textLimit, artifacts: [70000] });
});
test('custom ability output artifacts aggregate', async () => {
  await assert.rejects(ability(async r => { await r.writeArtifact(new Uint8Array(60000)); await r.writeArtifact(new Uint8Array(40001)); }), /command byte limit exceeded/);
});
test('custom ability cannot exceed text limit', async () => {
  await assert.rejects(ability(async r => { await r.write('x'.repeat(textLimit + 1)); }), /command byte limit exceeded/);
});
test('UTF-8 is accounted per write, including split surrogates', async () => {
  await assert.rejects(ability(async r => { await r.write('x'.repeat(textLimit - 4)); await r.write('\ud83d'); await r.write('\ude00'); }), /command byte limit exceeded/);
});
test('custom ability inputs retain command budget', async () => {
  await assert.rejects(ability(async r => { await r.readFile('owned.bin'); }), /command byte limit exceeded/);
});
test('custom ability default still shares artifact and text budget', async () => {
  await assert.rejects(ability(async r => { await r.writeArtifact(new Uint8Array(textLimit)); await r.write('x'); }, {}), /command byte limit exceeded/);
});
test('validated output budget cannot be changed by caller after creation', async () => {
  const limits = { maxCommandBytes: textLimit, maxArtifactBytes: 100000, maxOutputArtifactBytes: 10 };
  const controller = createPlaywrightController({ limits, abilities: { screenshot: { async execute(r) { await r.writeArtifact(new Uint8Array(11)); } } } });
  limits.maxOutputArtifactBytes = Infinity;
  try {
    await assert.rejects(controller.run({ args: ['screenshot'], env: {}, signal: AbortSignal.timeout(3000), write: async () => {}, writeArtifact: async () => {} }), /command byte limit exceeded/);
  } finally { await controller.dispose(); }
});
test('invalid output artifact limits are rejected', () => {
  for (const value of [0, -1, NaN, 1.5]) assert.throws(() => createPlaywrightController({ limits: { maxOutputArtifactBytes: value } }), /Invalid Playwright limit/);
});
