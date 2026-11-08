/** S3 orders keys lexicographically by their UTF-8 bytes. */
export function compareKeys(left: string, right: string): number {
  const encoder = new TextEncoder();
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]! - b[index]!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
