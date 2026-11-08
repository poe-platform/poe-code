import { expect, it } from 'vitest';
import { readRetainedPropertyValue } from './retained-property-value.js';
import { literal } from './retained-values.js';
const numbers = ['0', '-0', '+0', '1.', '.5', '+.5', '-.5', '0002', '1e3', '1.e-3', '1e+003', '0xff', '0XFF', '0b101', '0o777', '0B001', '0O7', '0x', '-0x1', '+0b1', '1e', '.e1', '.', '-', '1.2.3', '1e1e1', 'Infinity', '-Infinity', 'NaN', '', '   ', ' 1 ', '1 2', '\u00a01\ufeff', '1e99999', '1e-99999', '0e99999', '9007199254740993', '1.7976931348623157e308', '2.4703282292062327e-324', '2.4703282292062328e-324', '0x' + '0'.repeat(3000) + 'ff', '0x' + 'f'.repeat(3000), '0b' + '1'.repeat(1024), '0o' + '7'.repeat(342), '1.' + '0'.repeat(4000) + '1', '0.' + '0'.repeat(4000) + '1e4001', '1' + '0'.repeat(4000) + 'e-4000'];
for (const input of numbers) it(`converts a streamed number like Number: ${input.slice(0, 40)} (${input.length})`, async () => {
  const expected = input.trim() !== '' && Number.isFinite(Number(input)) ? Number(input) : null;
  expect(await readRetainedPropertyValue('number', literal(input), () => {})).toBe(expected);
});
for (const input of ['true', 'false', '1', '0', ' true', 'false ', '', 'TRUE', '0'.repeat(4000)]) it(`converts streamed boolean ${input.slice(0, 20)}`, async () => {
  expect(await readRetainedPropertyValue('boolean', literal(input), () => {})).toBe(input === 'true' || input === '1' ? true : input === 'false' || input === '0' ? false : null);
});
for (const input of ['2000', '2000-02', '2000-02-29', '2001-02-29', '2000-01-01T00:00:00Z', '2000-01-01T12:34:56.123' + '4'.repeat(4000) + 'Z', '2000-01-01T12:34:56.' + '0'.repeat(4000) + '+02:30', '2000-01-01T12:34:56.' + 'x'.repeat(4000) + 'Z', '0000', '2000-1-1', '2000-01-01T00:00:00+0130', '2000-01-01T24:00:00Z', '2000-01-01T00:00Z']) it(`converts streamed date ${input.slice(0, 40)} (${input.length})`, async () => {
  const { decodePropertyValue } = await import('./property-value.js');
  expect(await readRetainedPropertyValue('date', literal(input), () => {})).toBe(decodePropertyValue('date', input));
});
