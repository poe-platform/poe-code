import assert from 'node:assert/strict';

export const identity = 'Independent TIME-ENV fraction semantics reviewer, fresh thread 2026-08-27; neither Curie nor prior fix verifier; no delegation';
export const commit = 'c7823633ee99f711f1319ace59d4cf2b7f622ecc';
export const formatHash = 'ddbabf9ac2918869ed32a641fb9e2c290ee71b9bbf07ccaab64f9fc3b29b22b0';
export const modulus = (value, divisor) => ((value % divisor) + divisor) % divisor;
export const leap = year => modulus(year, 4) === 0 && (modulus(year, 100) !== 0 || modulus(year, 400) === 0);
export function dayNumber(year, month, day) {
  const previous = year - 1;
  const months = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return 365 * previous + Math.floor(previous / 4) - Math.floor(previous / 100)
    + Math.floor(previous / 400) + months.slice(0, month - 1).reduce((total, length) => total + length, 0) + day - 1;
}
export function isoArithmetic(year, month, day) {
  const serial = dayNumber(year, month, day);
  const firstMonday = candidate => {
    const fourth = dayNumber(candidate, 1, 4);
    return fourth - modulus(fourth, 7);
  };
  const isoYear = serial < firstMonday(year) ? year - 1 : serial >= firstMonday(year + 1) ? year + 1 : year;
  return { isoYear, week: 1 + Math.floor((serial - firstMonday(isoYear)) / 7), weekday: modulus(serial, 7) + 1 };
}
export function gnuComponent(year, isoYear) {
  const adjustment = isoYear - year;
  const tmYear = year - 1900;
  const remainder = (tmYear % 100 + adjustment) % 100;
  return remainder >= 0 ? remainder : isoYear < 0 ? -remainder : remainder + 100;
}
const pad = (value, width = 2) => String(value).padStart(width, '0');
const signedYear = year => year < 0 ? '-' + pad(-year, 3) : pad(year, 4);
export function isoText(year, month, day, component = 'magnitude') {
  const { isoYear, week, weekday } = isoArithmetic(year, month, day);
  const value = component === 'gnu' ? gnuComponent(year, isoYear) : Math.abs(isoYear % 100);
  return `${signedYear(isoYear)}|${pad(value)}|${pad(week)}|${weekday}\n`;
}
export function epoch(year, month, day) {
  return (dayNumber(year, month, day) - dayNumber(1970, 1, 1)) * 86400;
}
export function fractionFields(input) {
  const match = /^@([+-]?)(\d+)(?:\.(\d+))?$/.exec(input);
  assert.ok(match);
  let nanoseconds = BigInt(match[2]) * 1000000000n + BigInt((match[3] ?? '').padEnd(9, '0'));
  if (match[1] === '-') nanoseconds = -nanoseconds;
  const seconds = nanoseconds >= 0n ? nanoseconds / 1000000000n : (nanoseconds - 999999999n) / 1000000000n;
  return { seconds: seconds.toString(), digits: (nanoseconds - seconds * 1000000000n).toString().padStart(9, '0') };
}
const product = [];
const proof = [];
const add = row => product.push({ id: `new-${String(product.length + 1).padStart(3, '0')}`, zone: 'UTC0', clock: 1234567890123, expectedSamples: 0, ...row });
const inputs = ['@0', '@+0.000000000', '@0.000000001', '@0.000000010', '@0.000001000', '@0.000010200',
  '@0.010002030', '@0.100000001', '@0.120030000', '@0.999999999', '@1.000000001', '@17.999999990',
  '@-0.000000001', '@-0.000000010', '@-0.999999999', '@-1.000000001', '@-17.120030000', '@-17.999999999'];
const flags = ['', '-', '_', '0', '-_', '_-', '-0', '0-', '_0', '0_', '^_0', '0^_', '_#-', '-#0', '--'];
const widths = ['', '0', '00', '1', '2', '4', '7', '8', '9', '10', '13', '31'];
const directives = [...new Set(flags.flatMap(flag => widths.map(width => `%${flag}${width}N`)))].filter(value => value !== '%-N');
for (const input of inputs) {
  add({ category: 'fraction-width-flags', args: ['-d', input, '+' + directives.join('|')], directives });
  const { digits, seconds } = fractionFields(input);
  const unpadded = digits.replace(/0+$/, '') || '0';
  add({ category: 'bare-N-strict-profile', args: ['-d', input, '+%s|%-N|%--N|%0-N|%-9N|%6N|%%-N|%%%-N'],
    expectedText: `${seconds}|${unpadded}|${unpadded}|${unpadded}|${unpadded}|${digits.slice(0, 6)}|%-N|%${unpadded}\n` });
}
for (const year of [0, 1, 4, 99, 100, 101, 399, 400, 401, 1699, 1700, 1799, 1800, 1899, 1900, 1999, 2000, 2099, 2100]) {
  for (const [month, day] of [[1, 1], [1, 2], [1, 4], [12, 28], [12, 29], [12, 31]]) {
    const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
    for (const zone of ['UTC0', 'GMT+09:30']) add({ category: 'iso-arithmetic', zone, args: ['-d', `${date} 12:00:00`, '+%G|%g|%V|%u'], expectedText: isoText(year, month, day), calendar: [year, month, day] });
  }
}
for (const year of [...Array.from({ length: 400 }, (_, index) => index - 400), -1901, -1900, -1899, -2001, -2000, -1999]) {
  for (const [month, day] of [[1, 1], [1, 4], [12, 28], [12, 31]]) proof.push({
    id: `proof-${proof.length + 1}`, category: 'negative-year-primary-proof', zone: 'UTC0', calendar: [year, month, day],
    args: ['-d', '@' + epoch(year, month, day), '+%G|%g|%V|%u'],
    magnitudeText: isoText(year, month, day), sourceBranchText: isoText(year, month, day, 'gnu'),
  });
}
for (const zone of ['UTC0', 'GMT-05:45', 'GMT+03:30', 'America/New_York', 'Asia/Kathmandu', 'Europe/Paris']) {
  for (const input of ['@-0.000000001', '@0.000000001', '@1704067199.999999999']) add({ category: 'zone-boundary', zone, args: ['-d', input, '+%F %T|%G|%g|%V|%u|%s|%N|%4N|%13N|%::z'] });
}
for (const [clock, input, seconds, nano, samples] of [
  [1704067199999, undefined, '1704067199', '999000000', 1],
  [1704067200000, 'now', '1704067200', '000000000', 1],
  [-0.000001, undefined, '-1', '999999999', 1],
  [0.000001, 'today', '0', '000000001', 1],
  [-1000.000001, 'now', '-2', '999999999', 1],
  [999.999999, undefined, '0', '999999999', 1],
  [0.0000001, undefined, '0', '000000000', 1],
  [-0.0000001, undefined, '-1', '999999999', 1],
  [111.222333, '+1 seconds', '1', '111222333', 1],
  [999999999999, '@-0.000000001', '-1', '999999999', 0],
]) {
  const trim = nano.replace(/0+$/, '') || '0';
  add({ category: 'clock-precision-samples', clock, expectedSamples: samples,
    args: [...(input === undefined ? [] : ['-d', input]), '+%s|%N|%4N|%13N|%-N|%s|%N'],
    expectedText: `${seconds}|${nano}|${nano.slice(0, 4)}|${nano}0000|${trim}|${seconds}|${nano}\n`, native: false });
}
for (const [format, limits, text, error] of [
  ['%4096N', {}, '120030000' + '0'.repeat(4087) + '\n'],
  ['%4097N', {}, undefined, 'time-env format width limit exceeded'],
  ['%-4097N', {}, undefined, 'time-env format width limit exceeded'],
  ['%9007199254740992N', {}, undefined, 'time-env format width limit exceeded'],
  ['%_1000000000N', { maxFormatWidth: Number.MAX_SAFE_INTEGER, maxOutputBytes: 32 }, undefined, 'time-env output limit exceeded'],
  ['%-1000000000N', { maxFormatWidth: Number.MAX_SAFE_INTEGER, maxOutputBytes: 7 }, '12003\n'],
  ['%0-1000000000N', { maxFormatWidth: Number.MAX_SAFE_INTEGER, maxOutputBytes: 7 }, '12003\n'],
  ['%-01000000000N', { maxFormatWidth: Number.MAX_SAFE_INTEGER, maxOutputBytes: 32 }, undefined, 'time-env output limit exceeded'],
  ['é%4N%_9N', { maxOutputBytes: 16 }, 'é120012003    \n'],
  ['é%4N%_9N', { maxOutputBytes: 15 }, undefined, 'time-env output limit exceeded'],
]) add({ category: 'allocation-admission', args: ['-d', '@0.120030000', '+' + format], limits, expectedText: text, expectedError: error, native: !error && format.length < 10 });
for (const [format, message] of [['%EN', 'unsupported date format modifier: %EN'], ['%ON', 'unsupported date format modifier: %ON'], ['%:N', 'unsupported date format directive']]) {
  add({ category: 'negative-modifier', args: ['-d', '@0.12', '+before' + format], native: false, expectedStatus: 1, expectedText: '', expectedStderr: `date: ${message}\n` });
}
for (const date of ['0000-02-30', '0001-02-29', '0100-02-29', '1900-02-29', '2100-02-29']) {
  add({ category: 'negative-calendar', args: ['-d', date, '+%G|%g|%N'], native: false, expectedStatus: 1, expectedText: '', expectedStderr: 'date: invalid calendar date\n' });
}
for (const [input, format] of [['@0.123456789', '%12N'], ['@0.123456789', '%-N']]) add({ category: 'canonical-proposal-control', args: ['-d', input, '+' + format], expectedText: format === '%12N' ? '123456789000\n' : '123456789\n' });
export const cases = { schema: 1, identity, commit, formatHash, policy: 'Frozen before any product invocation; source-proof rows counted separately; strict native mismatches never converted to passes.', product, proof };
