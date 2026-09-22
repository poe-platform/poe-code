import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as soffice from './index.js';

const limits = { argumentBytes: 4096, files: 20, inputBytes: 4096, retainedBytes: 8192, outputBytes: 4096, nodes: 100, pages: 10, work: 10000 };
const bytes = (args: string[]) => args.map(arg => new TextEncoder().encode(arg));
const errorCode = (code: string) => (error: unknown) => error instanceof soffice.SofficeError && error.code === code;

test('byte argv and SDK text preserve event ownership, Unicode and literal BOM paths', () => {
  const args = ['\ufeffrésumé.docx', '--convert-to', 'pdf:writer_pdf_Export:{"x":"a:b"}', '--nologo', '--outdir', '/输出', '🙂.docx'];
  const textBudget = soffice.createSofficeBudget(limits, new AbortController().signal);
  const byteBudget = soffice.createSofficeBudget(limits, new AbortController().signal);
  try {
    assert.equal(typeof soffice.parseSofficeByteArguments, 'function');
    assert.deepEqual(soffice.parseSofficeByteArguments(bytes(args), byteBudget), soffice.parseSofficeArguments(args, textBudget));
    assert.equal(byteBudget.used('argumentBytes'), bytes(args).reduce((sum, arg) => sum + arg.length, 0));
  } finally { textBudget.close(); byteBudget.close(); }
});

test('byte argv rejects invalid UTF-8, NUL and unsupported authority without replacement decoding', () => {
  for (const args of [[new Uint8Array([0xff])], [new Uint8Array([0xc0, 0xaf])], [new Uint8Array([0xed, 0xa0, 0x80])], [new Uint8Array([97, 0, 98])]]) {
    const budget = soffice.createSofficeBudget(limits, new AbortController().signal);
    try {
      assert.throws(() => soffice.parseSofficeByteArguments(args, budget), errorCode('invalid-argument'));
      assert.equal(budget.used('retainedBytes'), 0);
    } finally { budget.close(); }
  }
  const budget = soffice.createSofficeBudget(limits, new AbortController().signal);
  try {
    assert.throws(() => soffice.parseSofficeByteArguments(bytes(['--accept=socket,host=localhost']), budget), errorCode('unsupported'));
    assert.equal(budget.used('retainedBytes'), 0);
  } finally { budget.close(); }
});

test('byte admission bounds allocation, work and bytes; empty argv still checks cancellation', () => {
  for (const override of [{ argumentBytes: 1 }, { retainedBytes: 1 }, { work: 0 }]) {
    const budget = soffice.createSofficeBudget({ ...limits, ...override }, new AbortController().signal);
    try {
      assert.throws(() => soffice.parseSofficeByteArguments(bytes(['é']), budget), errorCode('limit'));
      assert.equal(budget.used('retainedBytes'), 0);
    } finally { budget.close(); }
  }
  const controller = new AbortController();
  const budget = soffice.createSofficeBudget(limits, controller.signal);
  controller.abort();
  assert.throws(() => soffice.parseSofficeByteArguments([], budget), errorCode('cancelled'));
  budget.close();
  assert.throws(() => soffice.parseSofficeByteArguments([], budget), errorCode('closed'));
});

test('cancellation prevents new reservations but permits invocation rollback', () => {
  const controller = new AbortController();
  const budget = soffice.createSofficeBudget(limits, controller.signal);
  budget.charge('retainedBytes', 4);
  controller.abort();
  assert.throws(() => budget.charge('retainedBytes', 1), errorCode('cancelled'));
  budget.releaseRetainedBytes(4);
  assert.equal(budget.used('retainedBytes'), 0);
  budget.close();
  assert.throws(() => budget.releaseRetainedBytes(0), errorCode('closed'));
});

test('arguments are independent UTF-8 records and failed admission preserves earlier ownership', () => {
  const budget = soffice.createSofficeBudget(limits, new AbortController().signal);
  try {
    const input = bytes(['first.docx']);
    const request = soffice.parseSofficeByteArguments(input, budget);
    const retained = budget.used('retainedBytes');
    assert.ok(retained > 0);
    input[0]!.fill(120);
    assert.equal(request.files[0]?.path, 'first.docx');
    // A valid sequence split across argv entries must not be stitched together.
    assert.throws(() => soffice.parseSofficeByteArguments([new Uint8Array([0xc3]), new Uint8Array([0xa9])], budget), errorCode('invalid-argument'));
    assert.equal(budget.used('retainedBytes'), retained);
    assert.throws(() => soffice.parseSofficeByteArguments(bytes(['--convert-to', 'pdf', 'a.docx', '--unknown']), budget), errorCode('invalid-argument'));
    assert.equal(budget.used('retainedBytes'), retained);
  } finally { budget.close(); }
});

test('cancellation inside byte admission rolls back only new decoding reservations', () => {
  const controller = new AbortController(), budget = soffice.createSofficeBudget(limits, controller.signal);
  budget.charge('retainedBytes', 19);
  const charge = budget.charge.bind(budget);
  budget.charge = (resource, amount) => {
    charge(resource, amount);
    if (resource === 'argumentBytes') controller.abort();
  };
  assert.throws(() => soffice.parseSofficeByteArguments(bytes(['document.docx']), budget), errorCode('cancelled'));
  assert.equal(budget.used('retainedBytes'), 19);
  budget.close();
});
