import { test, expect } from 'vitest';
import * as sdk from './index.js';
import { WorkbookInput } from './operations/workbook-input.js';
import { Runtime } from './runtime.js';

test('public workbook SDK exposes the actual CLI reader and its invocation runtime', () => {
  expect(sdk).toHaveProperty('WorkbookInput', WorkbookInput);
  expect(sdk).toHaveProperty('Runtime', Runtime);
});
