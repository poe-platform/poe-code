// Compensated Taylor terms avoid Math.sin's one-ULP errors in double PCM.
// The split reduction below is accurate for the small angles used by audio filters.
export function audioSine(angle: number): number {
  if (Math.abs(angle) > 2 * Math.PI) return Math.sin(angle);
  const quadrant = Math.round(angle / (Math.PI / 2));
  // Split π/2 so subtraction retains the low bits near quadrant boundaries.
  const reduced = add([angle - quadrant * 1.5707963267341256, 0], [-quadrant * 6.077100506506192e-11, 0]);
  const square = multiply(reduced, reduced);
  square[0] = -square[0];
  square[1] = -square[1];
  let term: [number, number] = quadrant % 2 ? [1, 0] : reduced;
  let sum = term;
  // |reduced| <= π/4; terms through degree 19 leave less than 4e-21 error.
  for (let n = quadrant % 2 ? 2 : 3; n <= 19; n += 2) {
    const product = multiply(term, square);
    const divisor = n * (n - 1);
    const high = product[0] / divisor;
    const remainder = add(product, multiply([-high, 0], [divisor, 0]));
    term = add([high, 0], [(remainder[0] + remainder[1]) / divisor, 0]);
    sum = add(sum, term);
  }
  return (quadrant & 2 ? -1 : 1) * (sum[0] + sum[1]);
}

function multiply(a: [number, number], b: [number, number]): [number, number] {
  const product = a[0] * b[0];
  // Dekker's split separates each double into non-overlapping 26/27-bit parts.
  const splitA = 134217729 * a[0];
  const highA = splitA - (splitA - a[0]);
  const lowA = a[0] - highA;
  const splitB = 134217729 * b[0];
  const highB = splitB - (splitB - b[0]);
  const lowB = b[0] - highB;
  const error = ((highA * highB - product) + highA * lowB + lowA * highB) + lowA * lowB
    + a[0] * b[1] + a[1] * b[0];
  return [product, error];
}

function add(a: [number, number], b: [number, number]): [number, number] {
  const sum = a[0] + b[0];
  const part = sum - a[0];
  const error = (a[0] - (sum - part)) + (b[0] - part) + a[1] + b[1];
  const high = sum + error;
  return [high, error - (high - sum)];
}
