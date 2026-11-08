// Bessel functions of the first kind, orders zero and one (DLMF 10.2.2,
// 10.17.1–3). Fixed iteration bounds keep per-pixel evaluation bounded.
export function besselJ(order: 0 | 1, value: number): number {
  const x = Math.abs(value);
  if (!Number.isFinite(x)) return Number.isNaN(x) ? NaN : 0;
  let result: number;
  if (x < 16) {
    let term = order === 0 ? 1 : x / 2;
    result = term;
    for (let k = 1; k <= 64; k++) {
      term *= -(x * x / 4) / (k * (k + order));
      result += term;
      if (Math.abs(term) <= Number.EPSILON * Math.abs(result)) break;
    }
  } else {
    // The power series loses precision through cancellation for large x.
    // Sum the asymptotic cosine/sine coefficients instead.
    let term = 1;
    let cosine = 1;
    let sine = 0;
    for (let k = 1; k <= 32; k++) {
      const next = term * ((4 * order * order - (2 * k - 1) ** 2) / k / 8 / x);
      if (Math.abs(next) > Math.abs(term)) break;
      term = next;
      const signed = Math.floor(k / 2) % 2 === 0 ? term : -term;
      if (k % 2 === 0) cosine += signed;
      else sine += signed;
      if (Math.abs(term) < Number.EPSILON) break;
    }
    // Angle addition avoids losing the phase offset when x is very large.
    const sin = Math.sin(x);
    const cos = Math.cos(x);
    const phaseCos = order === 0 ? cos + sin : sin - cos;
    const phaseSin = order === 0 ? sin - cos : -cos - sin;
    result = (phaseCos * cosine - phaseSin * sine) / Math.sqrt(Math.PI) / Math.sqrt(x);
  }
  return order === 1 && value < 0 ? -result : result;
}
