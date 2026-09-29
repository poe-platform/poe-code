import { expect, test } from 'vitest';
import { SSF } from '@e965/xlsx';
import { legacyWorkbookDateFormat, workbookNumberFormats } from './operations/workbook-formats.js';

const formats = ['General', 'general', '0.00E+00', '0.0E-0', '0.0e+0', 'yyyy-mm-dd', 'hh:mm', '0;[Red]0;dd',
  '"date"0', '\\d0', '_m0', '* d', '*d', '[$USD]0', '[Red]0', '[h]', '[mm]', '[ss]', '[ช]', '[]',
  '[color[h]]', '[h', 'B1', 'b2', 'B3', 'AM/PM', 'A/P', '上午/下午', '0\\-0', '0?E0', '0\\-#E0', '0E', '0000', '???', '@',
  ...Object.values(SSF.get_table()).map(String)];
for (const format of formats) test(`legacy workbook date classification: ${format}`, () => {
  expect(legacyWorkbookDateFormat(format, () => {})).toBe(SSF.is_date(format));
});
test('built-in number format IDs retain the existing workbook profile', () => {
  expect(workbookNumberFormats).toEqual(SSF.get_table());
});
test('date-format scanning charges long quoted literals before completing', () => {
  let work = 0;
  expect(() => legacyWorkbookDateFormat('"' + 'x'.repeat(10000) + '"0', () => {
    if (++work > 100) throw new Error('work exhausted');
  })).toThrow('work exhausted');
});
