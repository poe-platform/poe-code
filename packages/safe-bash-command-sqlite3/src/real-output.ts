/** SQLite 3.43.2 sqlite3FpDecode's double-double path and %!g rendering.
 * Text uses 15 significant digits; the CLI's JSON mode requests 20.
 */
export function formatReal(value: number, precision: 15 | 20): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value < 0 ? '-Inf' : 'Inf';
  if (value === 0) return '0.0';
  let high = Math.abs(value), low = 0, exponent = 0;
  const bits = new DataView(new ArrayBuffer(8));
  function upper(x: number): number {
    bits.setFloat64(0, x);
    bits.setUint32(4, bits.getUint32(4) & 0xfc000000);
    return bits.getFloat64(0);
  }
  // Dekker multiplication retains the rounding error in a second double.
  function multiply(y: number, error: number): void {
    const hx = upper(high), hy = upper(y), tx = high - hx, ty = y - hy;
    const p = hx * hy, q = hx * ty + tx * hy, c = p + q;
    let cc = p - c + q + tx * ty;
    cc = high * error + low * y + cc;
    high = c + cc;
    low = c - high + cc;
  }
  if (high > 9223372036854775000) {
    while (high > 9.223372036854774e+118) { exponent += 100; multiply(1e-100, -1.9991899802602883e-117); }
    while (high > 9.223372036854774e+28) { exponent += 10; multiply(1e-10, -3.643219731549774e-27); }
    while (high > 9223372036854775000) { exponent++; multiply(0.1, -5.551115123125783e-18); }
  } else {
    while (high < 9.223372036854775e-83) { exponent -= 100; multiply(1e100, -1.5902891109759918e+83); }
    while (high < 92233720.36854775) { exponent -= 10; multiply(1e10, 0); }
    while (high < 922337203685477500) { exponent--; multiply(10, 0); }
  }
  let digits = (BigInt(Math.trunc(high)) + BigInt(Math.trunc(low))).toString();
  // SQLite's scaling can itself lose a bit at extreme exponents. JSON must
  // still recover the input double, including subnormal values.
  if (precision === 20 && Number(`${digits}e${exponent}`) !== Math.abs(value)) {
    const [mantissa, power] = Math.abs(value).toExponential(19).split('e');
    digits = mantissa!.replace('.', '');
    exponent = Number(power) - digits.length + 1;
  }
  let point = digits.length + exponent;
  if (digits.length > precision) {
    const roundUp = digits[precision]! >= '5';
    digits = (BigInt(digits.slice(0, precision)) + (roundUp ? 1n : 0n)).toString();
    if (digits.length > precision) point++;
  }
  while (digits.endsWith('0')) digits = digits.slice(0, -1);
  const sign = value < 0 ? '-' : '';
  exponent = point - 1;
  if (exponent < -4 || exponent >= precision) {
    return `${sign}${digits[0]}.${digits.slice(1) || '0'}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
