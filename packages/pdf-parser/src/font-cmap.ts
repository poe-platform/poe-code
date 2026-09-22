import type { SyntaxReader } from "./syntax.js";
/** Original sfnt cmap reader. Reverse maps only unambiguous Unicode glyph IDs. */
export function embeddedUnicodeCmap(
  data: Uint8Array,
  r: SyntaxReader,
  max: number
): Map<number, string | undefined> {
  const reader = r.fork(data);
  const b = reader.data;
  const read = (p: number, n: number): number => {
    r.charge(n);
    if (!Number.isSafeInteger(p) || p < 0 || p > b.length - n)
      r.fail("SYNTAX", "truncated embedded cmap");
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + b[p + i]!;
    return v;
  };
  if (read(0, 4) !== 0x10000 && read(0, 4) !== 0x4f54544f)
    r.fail("UNSUPPORTED", "embedded font is not sfnt");
  const tables = read(4, 2);
  let offset = -1,
    length = 0;
  if (tables > (b.length - 12) / 16) r.fail("SYNTAX", "sfnt table count");
  for (let i = 0; i < tables; i++) {
    const p = 12 + i * 16;
    r.charge();
    if (read(p, 4) === 0x636d6170) {
      offset = read(p + 8, 4);
      length = read(p + 12, 4);
    }
  }
  if (offset < 0) return new Map();
  if (length < 4 || offset > b.length - length) r.fail("SYNTAX", "sfnt cmap span");
  const count = read(offset + 2, 2);
  if (count > (length - 4) / 8) r.fail("SYNTAX", "cmap table count");
  const result = new Map<number, string | undefined>();
  let mappings = 0;
  const add = (code: number, gid: number) => {
    r.charge();
    if (++mappings > max) r.fail("LIMIT", "embedded cmap mapping limit");
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      r.fail("SYNTAX", "embedded cmap scalar");
    if (!gid) return;
    const value = String.fromCodePoint(code);
    r.reserve(64);
    if (result.has(gid) && result.get(gid) !== value) result.set(gid, undefined);
    else result.set(gid, value);
  };
  // Select a single Unicode subtable, preferring full repertoire to BMP.
  let chosen = -1,
    format = 0;
  for (let i = 0; i < count; i++) {
    const p = offset + 4 + i * 8,
      platform = read(p, 2),
      encoding = read(p + 2, 2),
      relative = read(p + 4, 4);
    if (relative > length - 2) r.fail("SYNTAX", "cmap subtable offset");
    const f = read(offset + relative, 2);
    if (
      (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) &&
      (f === 4 || f === 12) &&
      f > format
    ) {
      chosen = offset + relative;
      format = f;
    }
  }
  if (chosen < 0) return result;
  const size = read(chosen + (format === 12 ? 4 : 2), format === 12 ? 4 : 2),
    end = chosen + size;
  if (size < (format === 12 ? 16 : 16) || end > offset + length)
    r.fail("SYNTAX", "cmap subtable length");
  if (format === 12) {
    const groups = read(chosen + 12, 4);
    if (groups > (size - 16) / 12) r.fail("SYNTAX", "cmap group count");
    let previous = -1;
    for (let i = 0; i < groups; i++) {
      const p = chosen + 16 + i * 12,
        low = read(p, 4),
        high = read(p + 4, 4),
        gid = read(p + 8, 4);
      if (low <= previous || high < low || high > 0x10ffff || gid + high - low > 65535)
        r.fail("SYNTAX", "cmap group range");
      if (high - low + 1 > max - mappings) r.fail("LIMIT", "embedded cmap mapping limit");
      for (let c = low; c <= high; c++) add(c, gid + c - low);
      previous = high;
    }
  } else {
    const doubled = read(chosen + 6, 2);
    if (doubled % 2) r.fail("SYNTAX", "cmap segment count");
    const segments = doubled / 2;
    if (!segments || 16 + segments * 8 > size) r.fail("SYNTAX", "cmap segment span");
    let previous = -1;
    const ends = chosen + 14,
      starts = ends + segments * 2 + 2,
      deltas = starts + segments * 2,
      ranges = deltas + segments * 2;
    for (let i = 0; i < segments; i++) {
      const high = read(ends + i * 2, 2),
        low = read(starts + i * 2, 2),
        delta = read(deltas + i * 2, 2),
        range = read(ranges + i * 2, 2);
      if (low <= previous || high < low) r.fail("SYNTAX", "cmap segment range");
      if (range % 2) r.fail("SYNTAX", "unaligned cmap glyph offset");
      if (high - low + 1 > max - mappings) r.fail("LIMIT", "embedded cmap mapping limit");
      for (let c = low; c <= high && c !== 65535; c++) {
        let gid = 0;
        if (range) {
          const p = ranges + i * 2 + range + (c - low) * 2;
          if (p + 2 > end || p < ranges + segments * 2) r.fail("SYNTAX", "cmap glyph span");
          gid = read(p, 2);
          if (gid) gid = (gid + delta) % 65536;
        } else gid = (c + delta) % 65536;
        add(c, gid);
      }
      previous = high;
    }
  }
  return result;
}
