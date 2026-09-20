/** Validate bounded sfnt character maps before a font parser builds coverage arrays. */
export function admitCharacterMaps(view: DataView, start: number, length: number, fail: (message: string) => never, work: (amount: number) => void): void {
  const end = start + length;
  const range = (offset: number, size: number) => {if (offset < start || offset + size > end) fail("Invalid cmap range");};
  range(start, 4); const count = view.getUint16(start + 2);
  if (!count || count > 64) fail("Invalid cmap directory");
  range(start + 4, count * 8);
  const visited = new Set<number>();
  for (let i = 0; i < count; i++) {
    const sub = start + view.getUint32(start + 8 + i * 8); range(sub, 4);
    if (visited.has(sub)) continue; visited.add(sub);
    const format = view.getUint16(sub);
    if (format === 12 || format === 13) {
      range(sub, 16); const size = view.getUint32(sub + 4); const groups = view.getUint32(sub + 12);
      if (size < 16 || groups > 65536 || 16 + groups * 12 > size) fail("Invalid cmap groups");
      range(sub, size); let previous = -1;
      for (let g = 0; g < groups; g++) {
        const record = sub + 16 + g * 12; const first = view.getUint32(record); const last = view.getUint32(record + 4);
        if (first > last || first <= previous || last > 0x10ffff) fail("Invalid cmap Unicode range");
        work(last - first + 1); previous = last;
      }
    } else if (format === 4) {
      range(sub, 14); const size = view.getUint16(sub + 2); const segments = view.getUint16(sub + 6) / 2;
      if (!Number.isInteger(segments) || !segments || 16 + segments * 8 > size) fail("Invalid cmap segments");
      range(sub, size); let previous = -1;
      for (let g = 0; g < segments; g++) {
        const last = view.getUint16(sub + 14 + g * 2); const first = view.getUint16(sub + 16 + segments * 2 + g * 2);
        if (first > last || last <= previous) fail("Invalid cmap segment range");
        work(last - first + 1); previous = last;
        const offsetRecord = sub + 16 + segments * 6 + g * 2; const offset = view.getUint16(offsetRecord);
        if (offset) {range(offsetRecord + offset, (last - first + 1) * 2); if (offsetRecord + offset + (last - first + 1) * 2 > sub + size) fail("Invalid cmap glyph range");}
      }
    } else if (format === 0 || format === 6) {
      const size = view.getUint16(sub + 2); range(sub, size);
      if (format === 0) {if (size < 262) fail("Invalid byte cmap"); work(256);}
      else {if (size < 10) fail("Invalid trimmed cmap"); const entries = view.getUint16(sub + 8); if (size < 10 + entries * 2) fail("Invalid trimmed cmap entries"); work(entries);}
    } else fail("Unsupported cmap format");
  }
}

export function admitMetricTables(view: DataView, tables: ReadonlyMap<number, {start: number; length: number}>, fail: (message: string) => never, work: (amount: number) => void): void {
  const table = (tag: number, size: number) => {
    const record = tables.get(tag); if (!record || record.length < size) fail("Missing/truncated font metric table");
    return record!;
  };
  const head = table(0x68656164, 54); const maxp = table(0x6d617870, 6); const hhea = table(0x68686561, 36);
  const units = view.getUint16(head.start + 18); const glyphs = view.getUint16(maxp.start + 4); const metrics = view.getUint16(hhea.start + 34);
  if (units < 16 || units > 16384 || !glyphs || !metrics || metrics > glyphs) fail("Invalid font metric counts");
  table(0x686d7478, metrics * 4 + (glyphs - metrics) * 2);
  const glyf = tables.get(0x676c7966);
  if (glyf) {
    const format = view.getInt16(head.start + 50); if (format !== 0 && format !== 1) fail("Invalid glyph location format");
    const size = format === 0 ? 2 : 4; const loca = table(0x6c6f6361, (glyphs + 1) * size); let previous = 0;
    work(glyphs + 1);
    for (let i = 0; i <= glyphs; i++) {
      const offset = format === 0 ? view.getUint16(loca.start + i * size) * 2 : view.getUint32(loca.start + i * size);
      if (offset < previous || offset > glyf.length) fail("Invalid glyph outline range"); previous = offset;
    }
  }
}
