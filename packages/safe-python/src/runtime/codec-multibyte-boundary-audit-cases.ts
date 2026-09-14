/** Deterministic malformed inputs for the pinned external differential oracle. */
export function codecMultibyteBoundaryAuditCases() {
  const policies = ['strict', 'replace', 'ignore', 'surrogatepass', 'surrogateescape', 'backslashreplace'] as const;
  const cases: {bytes: number[]; width: 7 | 16 | 32; errors: typeof policies[number]; final: boolean}[] = [];
  let seed = 1234;
  for (let index = 0; index < 1500; index++) {
    const bytes: number[] = [];
    for (let offset = 0; offset < index % 10; offset++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes.push(seed >>> 24);
    }
    for (const width of [16, 32] as const) for (const errors of policies) for (const final of [true, false]) {
      cases.push({bytes, width, errors, final});
    }
  }
  seed = 1234;
  const alphabet = [43, 45, 65, 90, 97, 122, 48, 57, 47, 43, 61, 255, 0, 32];
  for (let index = 0; index < 5000; index++) {
    const bytes = [43];
    for (let offset = 0; offset < index % 14; offset++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes.push(alphabet[(seed >>> 24) % alphabet.length]);
    }
    for (const errors of policies) for (const final of [true, false]) {
      cases.push({bytes, width: 7, errors, final});
    }
  }
  return cases;
}
