import { test, expect } from 'vitest';
import { run, type CsvkitWorkbook, type CsvkitWorkbookCell, type InvocationContext } from './index.js';

// Compile-only regression: malformed SDK requests never execute host work.
function checkRequests(context: InvocationContext) {
  const cell: CsvkitWorkbookCell = { t: 'n', v: 1, z: 14 };
  const book: CsvkitWorkbook = { SheetNames: ['Data'], Sheets: { Data: { '!ref': 'A1', A1: cell } }, Workbook: { WBView: [{ activeTab: '0' }] } };
  void book;
  void run({ command: 'csvcut', settings: { columns: 'b,a,b', line_numbers: true } }, context);
  void run({ command: 'csvsql', settings: { queries: ['SELECT 1', 'SELECT 2'], engine_option: [['echo', 'True']] } }, context);
  void run({ command: 'in2csv', settings: { filetype: 'xlsx', sheet: 'Data', write_sheets: '-' } }, context);
  // @ts-expect-error csvcut has no inference flag
  void run({ command: 'csvcut', settings: { no_inference: true } }, context);
  // @ts-expect-error selectors use the original selector syntax, not arrays
  void run({ command: 'csvcut', settings: { columns: ['a', 'b'] } }, context);
  // @ts-expect-error repeated SQL queries preserve ordered values
  void run({ command: 'csvsql', settings: { queries: 'SELECT 1' } }, context);
  // @ts-expect-error DB options are ordered pairs
  void run({ command: 'sql2csv', settings: { engine_option: ['echo', 'True'] } }, context);
  // @ts-expect-error only original executable names are operations
  void run({ command: 'csvkit' }, context);
}

test('SDK type regression is compile-only', () => {
  expect(typeof checkRequests).toBe('function');
});
