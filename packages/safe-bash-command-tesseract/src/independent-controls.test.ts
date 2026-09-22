import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createTesseractBudget, inspectTraineddata, morphTesseractBinary,
  parseTesseractArguments, resolveTesseractPageSegMode, type TesseractRaster
} from './index.js';

const signal = new AbortController().signal;
const empty = '000000000';
const full = '111111111';
const limits = { maxWidth: 9, maxHeight: 7, maxPixels: 63, maxWork: 63 };
const bricks = [{ width: 1, height: 1 }, { width: 2, height: 1 }, { width: 3, height: 3 }, { width: 6, height: 1 }];

// Literal masks from the independently specified 9x7 controls. Expected rows
// are fixed boundary/anchor expectations, not another implementation of a kernel.
const controls = [
  {
    name: 'left edge', rows: Array<string>(7).fill('100000000'),
    dilate: [Array<string>(7).fill('100000000'), Array<string>(7).fill('100000000'),
      Array<string>(7).fill('110000000'), Array<string>(7).fill('111000000')],
    erode: [Array<string>(7).fill('100000000'), Array<string>(7).fill(empty),
      Array<string>(7).fill(empty), Array<string>(7).fill(empty)]
  },
  {
    name: 'point', rows: [empty, empty, empty, '000010000', empty, empty, empty],
    dilate: [[empty, empty, empty, '000010000', empty, empty, empty],
      [empty, empty, empty, '000110000', empty, empty, empty],
      [empty, empty, '000111000', '000111000', '000111000', empty, empty],
      [empty, empty, empty, '011111100', empty, empty, empty]],
    erode: [[empty, empty, empty, '000010000', empty, empty, empty],
      Array<string>(7).fill(empty), Array<string>(7).fill(empty), Array<string>(7).fill(empty)]
  },
  {
    name: 'gap row', rows: [empty, empty, empty, '111101111', empty, empty, empty],
    dilate: [[empty, empty, empty, '111101111', empty, empty, empty],
      [empty, empty, empty, full, empty, empty, empty],
      [empty, empty, full, full, full, empty, empty],
      [empty, empty, empty, full, empty, empty, empty]],
    erode: [[empty, empty, empty, '111101111', empty, empty, empty],
      [empty, empty, empty, '011100111', empty, empty, empty],
      Array<string>(7).fill(empty), Array<string>(7).fill(empty)]
  },
  {
    name: 'all on', rows: Array<string>(7).fill(full),
    dilate: Array.from({ length: 4 }, () => Array<string>(7).fill(full)),
    erode: [Array<string>(7).fill(full), Array<string>(7).fill('011111111'),
      [empty, '011111110', '011111110', '011111110', '011111110', '011111110', empty],
      Array<string>(7).fill('000111100')]
  }
];

test('independent literal morphology matrix: 32 boundary and anchor cells', () => {
  for (const control of controls) for (const operation of ['dilate', 'erode'] as const) {
    for (const [index, brick] of bricks.entries()) {
      const input: TesseractRaster = { width: 9, height: 7, dpi: 300, format: 'binary8',
        pixels: Uint8Array.from(control.rows.join(''), value => Number(value)) };
      const original = input.pixels.slice();
      const work = 63 * (1 + brick.width * brick.height);
      const budget = createTesseractBudget({ work, retainedBytes: 63, outputBytes: 63, pixels: 63 }, signal);
      const result = morphTesseractBinary(input, operation, brick, limits, budget, signal);
      try {
        assert.equal(Array.from(result.raster.pixels).join(''), control[operation][index]!.join(''),
          `${control.name}/${operation}/${brick.width}x${brick.height}`);
        assert.deepEqual(input.pixels, original);
        assert.notEqual(result.raster.pixels.buffer, input.pixels.buffer);
        assert.equal(budget.used('work'), work);
      } finally { result.dispose(); }
      for (const resource of ['retainedBytes', 'outputBytes', 'pixels'] as const) assert.equal(budget.used(resource), 0);
      assert.equal(budget.used('work'), work);
      budget.close();
    }
  }
});

test('all pinned symbolic modes and every FixPageSegMode pair', () => {
  const names = ['osd_only', 'auto_osd', 'auto_only', 'auto', 'single_column', 'single_block_vert_text',
    'single_block', 'single_line', 'single_word', 'circle_word', 'single_char', 'sparse_text', 'sparse_text_osd', 'raw_line'];
  for (const [psm, name] of names.entries()) {
    const symbolic = parseTesseractArguments(['scan', 'out', '--psm', name]);
    assert.deepEqual(symbolic, parseTesseractArguments(['scan', 'out', '--psm', String(psm)]));
    assert.equal(symbolic.psm, psm);
    assert.equal(symbolic.language, psm === 0 ? 'osd' : 'eng');
    for (let configured = 0; configured <= 13; configured++) {
      assert.equal(resolveTesseractPageSegMode(psm, configured), configured === 6 ? psm : configured);
    }
  }
  for (const [oem, name] of ['tesseract_only', 'lstm_only', 'tesseract_lstm_combined', 'default'].entries()) {
    assert.deepEqual(parseTesseractArguments(['scan', 'out', '--oem', name]),
      parseTesseractArguments(['scan', 'out', '--oem', String(oem)]));
  }
});

test('supplied model-container bytes respect subview boundaries and both byte orders', () => {
  for (const littleEndian of [true, false]) {
    const backing = new Uint8Array(64).fill(255);
    const bytes = backing.subarray(7, 40);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(0, 3, littleEndian);
    view.setBigInt64(4, 28n, littleEndian);
    view.setBigInt64(12, -1n, littleEndian);
    view.setBigInt64(20, 30n, littleEndian);
    const before = backing.slice();
    const admitted = { maxModelBytes: 33, maxComponents: 3 };
    assert.deepEqual(inspectTraineddata(bytes, admitted, signal), {
      littleEndian, recognitionQualified: false,
      components: [{ index: 0, offset: 28, length: 2 }, { index: 2, offset: 30, length: 3 }]
    });
    assert.deepEqual(backing, before);
    for (let length = 0; length < 31; length++) {
      assert.throws(() => inspectTraineddata(bytes.subarray(0, length), admitted, signal), { code: 'invalid-model' });
    }
    // Offset beyond the admitted view must not expose the surrounding buffer.
    view.setBigInt64(20, 34n, littleEndian);
    assert.throws(() => inspectTraineddata(bytes, admitted, signal), { code: 'invalid-model' });
  }
});
