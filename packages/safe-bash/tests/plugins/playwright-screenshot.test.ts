import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { capturePlaywrightScreenshot } from '../../src/playwright/screenshot.js';
import type { PlaywrightScreenshotCaptureOptions, PlaywrightScreenshotOptions, PlaywrightScreenshotPage } from '../../src/playwright/screenshot.js';

const defaults: PlaywrightScreenshotOptions = { type: 'png', fullPage: false, timeout: 5000, maxArtifactBytes: 16 * 1024 * 1024 };

for (const duringMeasurement of [false, true]) test(`cancellation ${duringMeasurement ? 'during' : 'before'} measurement prevents native capture`, async () => {
  const current = fixture();
  const abort = new AbortController();
  const reason = new Error('cancel screenshot');
  if (duringMeasurement) {
    const evaluate = current.page.evaluate!;
    current.page.evaluate = async (callback, argument) => {
      const result = await evaluate(callback, argument);
      abort.abort(reason);
      return result;
    };
  } else abort.abort(reason);
  const options = { ...defaults, signal: abort.signal };
  await assert.rejects(capturePlaywrightScreenshot(current.page, options), error => error === reason);
  assert.equal(current.captures.length, 0);
  assert.equal(current.measurements.length, duringMeasurement ? 1 : 0);
});

function element(width: unknown, height: unknown) {
  return { scrollWidth: width, scrollHeight: height, offsetWidth: width, offsetHeight: height, clientWidth: width, clientHeight: height };
}

function fixture(width: unknown = 1280, height: unknown = 720, bytes = new Uint8Array([1, 2, 3])) {
  const document = { body: element(width, height), documentElement: element(width, height) };
  const context = createContext({ innerWidth: width, innerHeight: height, devicePixelRatio: 1, document });
  const captures: PlaywrightScreenshotCaptureOptions[] = [];
  const measurements: unknown[] = [];
  const page: PlaywrightScreenshotPage = {
    async evaluate<Result, Argument>(callback: (argument: Argument) => Result, argument: Argument): Promise<Result> {
      context.argument = argument;
      const measured = runInContext(`(${callback.toString()})(argument)`, context);
      const encoded = JSON.stringify(measured);
      assert(encoded.length <= 100, 'geometry must have bounded serialized size');
      const result = JSON.parse(encoded) as Result;
      measurements.push(result);
      return result;
    },
    async screenshot(options) { captures.push(options); return bytes; },
  };
  return { page, context, document, captures, measurements, bytes };
}

for (const type of ['png', 'jpeg'] as const) {
  test(`${type} captures the default viewport with explicit fixed CSS geometry`, async () => {
    const current = fixture();
    const result = await capturePlaywrightScreenshot(current.page, { ...defaults, type });
    assert.equal(result, current.bytes);
    assert.deepEqual(current.measurements, [{ width: 1280, height: 720 }]);
    assert.deepEqual(current.captures, [{ type, fullPage: false, timeout: 5000, scale: 'css', clip: { x: 0, y: 0, width: 1280, height: 720 } }]);
  });

  test(`${type} allows an 8x8 image under a 1024-byte artifact limit`, async () => {
    const current = fixture(8, 8, new Uint8Array(1024));
    assert.equal((await capturePlaywrightScreenshot(current.page, { ...defaults, type, maxArtifactBytes: 1024 })).byteLength, 1024);
    assert.equal(current.captures.length, 1);
    assert.deepEqual(current.captures[0]!.clip, { x: 0, y: 0, width: 8, height: 8 });
  });

  test(`${type} admits a 16x16 raster but rejects noisy encoded bytes over 1024`, async () => {
    const current = fixture(16, 16, Uint8Array.from({ length: 1025 }, (_, index) => index % 256));
    await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, type, maxArtifactBytes: 1024 }), { message: 'Artifact byte limit exceeded' });
    assert.equal(current.captures.length, 1);
    assert.deepEqual(current.captures[0]!.clip, { x: 0, y: 0, width: 16, height: 16 });
  });

  for (const size of [2048, 4096]) {
    test(`${type} refuses an observed ${size}x${size} full page before native capture`, async () => {
      const current = fixture();
      Object.assign(current.document.body, element(size, size));
      await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, type, fullPage: true }), { message: 'Screenshot pixel limit exceeded' });
      assert.equal(current.measurements.length, 1);
      assert.equal(current.captures.length, 0);
    });
  }

  test(`${type} refuses a raster over the artifact-derived budget before native capture`, async () => {
    const current = fixture(17, 16);
    await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, type, maxArtifactBytes: 1024 }), { message: 'Screenshot pixel limit exceeded' });
    assert.equal(current.captures.length, 0);
  });
}

for (const fullPage of [false, true]) {
  for (const [width, height] of [[0, 8], [8, 0], [-1, 8], [8, -1], [NaN, 8], [8, NaN], [Infinity, 8], [8, Infinity], [Number.MAX_VALUE, 8], ['private page text', 8], [8, null]]) {
    test(`invalid geometry is refused without exporting page values: ${fullPage}/${String(width)}/${String(height)}`, async () => {
      const current = fixture(width, height);
      await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, fullPage }), { message: 'Invalid screenshot dimensions' });
      assert.deepEqual(current.measurements, [null]);
      assert.equal(current.captures.length, 0);
    });
  }

  test(`huge finite geometry is refused before native capture: fullPage=${fullPage}`, async () => {
    const current = fixture(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, fullPage }), { message: 'Screenshot pixel limit exceeded' });
    assert.equal(current.captures.length, 0);
  });

  test(`resizing after measurement cannot enlarge the capture: fullPage=${fullPage}`, async () => {
    const current = fixture(8, 8);
    const evaluate = current.page.evaluate!;
    current.page.evaluate = async (callback, argument) => {
      const measured = await evaluate(callback, argument);
      current.context.innerWidth = 4096;
      current.context.innerHeight = 4096;
      Object.assign(current.document.body, element(4096, 4096));
      Object.assign(current.document.documentElement, element(4096, 4096));
      return measured;
    };
    await capturePlaywrightScreenshot(current.page, { ...defaults, fullPage, maxArtifactBytes: 1024 });
    assert.deepEqual(current.captures[0], { type: 'png', fullPage, timeout: 5000, scale: 'css', clip: { x: 0, y: 0, width: 8, height: 8 } });
  });
}

test('full-page measurement includes scroll, offset and client dimensions on body and root', async () => {
  const current = fixture(1280, 720);
  current.document.body.offsetWidth = 1800;
  current.document.documentElement.clientHeight = 1400;
  await capturePlaywrightScreenshot(current.page, { ...defaults, fullPage: true });
  assert.deepEqual(current.captures[0]!.clip, { x: 0, y: 0, width: 1800, height: 1400 });
  assert.equal(current.captures[0]!.fullPage, true);
});

test('viewport capture does not measure or capture an oversized document', async () => {
  const current = fixture();
  Object.assign(current.document.body, element(4096, 4096));
  await capturePlaywrightScreenshot(current.page, defaults);
  assert.deepEqual(current.captures[0]!.clip, { x: 0, y: 0, width: 1280, height: 720 });
});

for (const ratio of [1, 2, 4, 100]) test(`DPR ${ratio} cannot increase the CSS raster budget`, async () => {
  const current = fixture(8, 8);
  current.context.devicePixelRatio = ratio;
  await capturePlaywrightScreenshot(current.page, { ...defaults, maxArtifactBytes: 1024 });
  assert.equal(current.captures[0]!.scale, 'css');
  assert.deepEqual(current.captures[0]!.clip, { x: 0, y: 0, width: 8, height: 8 });
});

for (const { type, width, height, allowed } of [
  { type: 'png', width: 2000, height: 2000, allowed: true },
  { type: 'png', width: 2001, height: 2000, allowed: false },
  { type: 'jpeg', width: 1000, height: 1000, allowed: true },
  { type: 'jpeg', width: 1001, height: 999, allowed: false },
  { type: 'jpeg', width: 1, height: 125000, allowed: true },
  { type: 'jpeg', width: 1, height: 125001, allowed: false },
] as const) test(`${type} transport ceiling ${width}x${height}: ${allowed}`, async () => {
  const current = fixture(width, height);
  const capture = capturePlaywrightScreenshot(current.page, { ...defaults, type, fullPage: true, maxArtifactBytes: Number.MAX_SAFE_INTEGER });
  if (allowed) {
    await capture;
    assert.equal(current.captures.length, 1);
  } else {
    await assert.rejects(capture, { message: 'Screenshot pixel limit exceeded' });
    assert.equal(current.captures.length, 0);
  }
});

test('fractional dimensions are rounded up before raster admission and fixed clipping', async () => {
  const current = fixture(7.2, 7.8);
  await capturePlaywrightScreenshot(current.page, { ...defaults, maxArtifactBytes: 256 });
  assert.deepEqual(current.captures[0]!.clip, { x: 0, y: 0, width: 8, height: 8 });
  const oversized = fixture(16.1, 16);
  await assert.rejects(capturePlaywrightScreenshot(oversized.page, { ...defaults, maxArtifactBytes: 1024 }), { message: 'Screenshot pixel limit exceeded' });
  assert.equal(oversized.captures.length, 0);
});

test('missing page evaluation refuses capture without a locator fallback', async () => {
  const current = fixture();
  delete current.page.evaluate;
  Object.defineProperty(current.page, 'locator', { get() { assert.fail('locator must not be used'); } });
  await assert.rejects(capturePlaywrightScreenshot(current.page, defaults), { message: 'Screenshot geometry evaluation unsupported' });
  assert.equal(current.captures.length, 0);
});

test('throwing page geometry getters return only a bounded invalid sentinel', async () => {
  const current = fixture();
  Object.defineProperty(current.document.body, 'scrollWidth', { get() { throw new Error('secret page text'); } });
  await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, fullPage: true }), { message: 'Invalid screenshot dimensions' });
  assert.deepEqual(current.measurements, [null]);
  assert.equal(current.captures.length, 0);
});

for (const fullPage of [false, true]) test(`throwing page globalThis lookup returns only a bounded invalid sentinel: ${fullPage}`, async () => {
  const current = fixture(8, 8);
  Object.defineProperty(current.context, 'globalThis', { get() { throw new Error('private page text'); } });
  await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, fullPage }), { message: 'Invalid screenshot dimensions' });
  assert.deepEqual(current.measurements, [null]);
  assert.equal(current.captures.length, 0);
});

test('geometry evaluation does not read page content or locators', async () => {
  const current = fixture();
  for (const key of ['innerText', 'textContent', 'innerHTML']) Object.defineProperty(current.document.body, key, { get() { assert.fail('page text must not be read'); } });
  Object.defineProperty(current.page, 'locator', { get() { assert.fail('locator must not be used'); } });
  await capturePlaywrightScreenshot(current.page, { ...defaults, fullPage: true });
  assert.deepEqual(current.measurements, [{ width: 1280, height: 720 }]);
});

for (const value of [null, 'private page text', { width: 'private page text', height: 8 }, { width: 0, height: 8 }, { width: NaN, height: 8 }, { width: Infinity, height: 8 }]) {
  test(`invalid host evaluation result cannot start capture: ${JSON.stringify(value)}`, async () => {
    const current = fixture();
    current.page.evaluate = async <Result>() => value as Result;
    await assert.rejects(capturePlaywrightScreenshot(current.page, defaults), { message: 'Invalid screenshot dimensions' });
    assert.equal(current.captures.length, 0);
  });
}

for (const value of [null, 'bytes', [1, 2], new ArrayBuffer(8), new Uint16Array(8)]) test(`native return must be Uint8Array: ${Object.prototype.toString.call(value)}`, async () => {
  const current = fixture(8, 8);
  current.page.screenshot = async options => { current.captures.push(options); return value as unknown as Uint8Array; };
  await assert.rejects(capturePlaywrightScreenshot(current.page, defaults), { message: 'Screenshot must return bytes' });
  assert.equal(current.captures.length, 1);
});

test('byte admission uses the returned view length, not its backing allocation', async () => {
  const bytes = new Uint8Array(2048).subarray(256, 1280);
  const current = fixture(8, 8, bytes);
  assert.equal(await capturePlaywrightScreenshot(current.page, { ...defaults, maxArtifactBytes: 1024 }), bytes);
});

for (const maxArtifactBytes of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) test(`invalid artifact budget ${maxArtifactBytes} is refused before page evaluation`, async () => {
  const current = fixture();
  await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, maxArtifactBytes }), { message: 'Invalid screenshot options' });
  assert.deepEqual(current.measurements, []);
  assert.deepEqual(current.captures, []);
});

for (const node of ['body', 'documentElement'] as const) {
  for (const dimension of ['scrollWidth', 'scrollHeight', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight'] as const) {
    test(`full-page geometry refuses ${node}.${dimension} without coercing page objects`, async () => {
      const current = fixture(8, 8);
      current.document[node][dimension] = {
        [Symbol.toPrimitive]() { assert.fail('page-controlled geometry must not be coerced'); },
        toJSON() { assert.fail('page-controlled geometry must not be exported'); },
      };
      await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, fullPage: true }), { message: 'Invalid screenshot dimensions' });
      assert.deepEqual(current.measurements, [null]);
      assert.deepEqual(current.captures, []);
    });
  }
}

for (const expression of ['delete document.body', 'delete document.documentElement', 'delete globalThis.document']) test(`missing full-page geometry fails closed: ${expression}`, async () => {
  const current = fixture(8, 8);
  runInContext(expression, current.context);
  await assert.rejects(capturePlaywrightScreenshot(current.page, { ...defaults, fullPage: true }), { message: 'Invalid screenshot dimensions' });
  assert.deepEqual(current.measurements, [null]);
  assert.deepEqual(current.captures, []);
});

test('viewport capture does not access document or devicePixelRatio getters', async () => {
  const current = fixture(8, 8);
  let reads = 0;
  for (const key of ['document', 'devicePixelRatio']) Object.defineProperty(current.context, key, { get() { reads++; throw new Error('private page text'); } });
  await capturePlaywrightScreenshot(current.page, { ...defaults, maxArtifactBytes: 256 });
  assert.equal(reads, 0);
  assert.deepEqual(current.measurements, [{ width: 8, height: 8 }]);
  assert.equal(current.captures.length, 1);
});

for (const { type, width, height, budget, allowed } of [
  { type: 'png', width: 1, height: 1, budget: 3, allowed: false },
  { type: 'png', width: 1, height: 1, budget: 4, allowed: true },
  { type: 'png', width: 8, height: 8, budget: 255, allowed: false },
  { type: 'png', width: 8, height: 8, budget: 259, allowed: true },
  { type: 'png', width: Number.MIN_VALUE, height: Number.MIN_VALUE, budget: 4, allowed: true },
  { type: 'png', width: 8.01, height: 8, budget: 287, allowed: false },
  { type: 'png', width: 8.01, height: 8, budget: 288, allowed: true },
  { type: 'jpeg', width: 1, height: 1, budget: 255, allowed: false },
  { type: 'jpeg', width: 1, height: 1, budget: 256, allowed: true },
  { type: 'jpeg', width: 8.01, height: 8, budget: 511, allowed: false },
  { type: 'jpeg', width: 8.01, height: 8, budget: 512, allowed: true },
  { type: 'jpeg', width: 8.01, height: 8.01, budget: 1023, allowed: false },
  { type: 'jpeg', width: 8.01, height: 8.01, budget: 1024, allowed: true },
  { type: 'png', width: Number.MAX_SAFE_INTEGER, height: 1, budget: Number.MAX_SAFE_INTEGER, allowed: false },
  { type: 'jpeg', width: 1, height: Number.MAX_SAFE_INTEGER, budget: Number.MAX_SAFE_INTEGER, allowed: false },
] as const) test(`exact raster admission ${type}/${width}x${height}/${budget}: ${allowed}`, async () => {
  const current = fixture(width, height);
  const pending = capturePlaywrightScreenshot(current.page, { ...defaults, type, maxArtifactBytes: budget });
  if (allowed) {
    assert.equal(await pending, current.bytes);
    assert.deepEqual(current.captures[0]!.clip, { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) });
  } else await assert.rejects(pending, { message: 'Screenshot pixel limit exceeded' });
  assert.equal(current.captures.length, allowed ? 1 : 0);
});

for (const reason of [false, null, { cancelled: true }, new Error('engine failure')]) {
  for (const method of ['evaluate', 'screenshot'] as const) test(`native ${method} rejection retains ${JSON.stringify(reason)} identity`, async () => {
    const current = fixture(8, 8);
    current.page[method] = async () => { throw reason; };
    await assert.rejects(capturePlaywrightScreenshot(current.page, defaults), error => Object.is(error, reason));
    assert.equal(current.measurements.length, method === 'evaluate' ? 0 : 1);
    assert.deepEqual(current.captures, []);
  });
}

for (const options of [null, { ...defaults, type: 'webp' }, { ...defaults, fullPage: 1 }, { ...defaults, timeout: 0 },
  { ...defaults, timeout: -1 }, { ...defaults, timeout: 1.5 }, { ...defaults, timeout: Infinity }, { ...defaults, timeout: Number.MAX_SAFE_INTEGER + 1 }]) {
  test(`invalid capture configuration fails before measurement: ${JSON.stringify(options)}`, async () => {
    const current = fixture(8, 8);
    await assert.rejects(capturePlaywrightScreenshot(current.page, options as PlaywrightScreenshotOptions), { message: 'Invalid screenshot options' });
    assert.deepEqual(current.measurements, []);
    assert.deepEqual(current.captures, []);
  });
}

test('capture options stay fixed while asynchronous geometry evaluation is pending', async () => {
  const current = fixture(8, 8);
  const options = { ...defaults, maxArtifactBytes: 256 };
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const evaluate = current.page.evaluate!;
  current.page.evaluate = async (callback, argument) => {
    const measured = await evaluate(callback, argument);
    entered();
    await held;
    return measured;
  };
  const pending = capturePlaywrightScreenshot(current.page, options);
  try {
    await started;
    Object.assign(options, { type: 'jpeg', fullPage: true, timeout: 1, maxArtifactBytes: 1 });
    release();
    assert.equal(await pending, current.bytes);
    assert.deepEqual(current.captures, [{ type: 'png', fullPage: false, timeout: 5000, scale: 'css', clip: { x: 0, y: 0, width: 8, height: 8 } }]);
  } finally { release(); }
});

test('native capture cannot widen the artifact budget by mutating caller options', async () => {
  const current = fixture(8, 8, new Uint8Array(257));
  const options = { ...defaults, maxArtifactBytes: 256 };
  current.page.screenshot = async capture => {
    current.captures.push(capture);
    options.maxArtifactBytes = Number.MAX_SAFE_INTEGER;
    return current.bytes;
  };
  await assert.rejects(capturePlaywrightScreenshot(current.page, options), { message: 'Artifact byte limit exceeded' });
  assert.equal(current.captures.length, 1);
});
