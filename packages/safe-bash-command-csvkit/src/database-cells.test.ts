import { test } from 'vitest';
import assert from 'node:assert/strict';
import { writeCsvRow, type CsvWriteCell } from './csv.js';

test('driver float cells retain Python repr and numeric CSV quoting', () => {
  const cells = [{ kind: 'float', value: '1.0' }, { kind: 'float', value: '-0.0' }] satisfies CsvWriteCell[];
  assert.equal(writeCsvRow(cells), '1.0,-0.0\n');
  assert.equal(writeCsvRow(cells, { quoting: 2 }), '1.0,-0.0\n');
});
