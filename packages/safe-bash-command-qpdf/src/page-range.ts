function parseSingleTokenPageNumber(tok: string, totalPages: number): number {
  const trimmed = tok.trim();
  if (trimmed === "z") return totalPages;
  if (trimmed.startsWith("r")) {
    const rev = Number.parseInt(trimmed.slice(1), 10);
    if (!Number.isFinite(rev) || rev < 1 || rev > totalPages) {
      throw new Error(`Invalid reverse page number '${tok}'`);
    }
    return totalPages - rev + 1;
  }
  const num = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(num) || num < 1 || num > totalPages) {
    throw new Error(`Page number '${tok}' out of bounds (1..${totalPages})`);
  }
  return num;
}

interface RangePart { readonly first: number; readonly last: number; readonly step: number; readonly excluded: boolean }

/** Expand on demand. Later exclusions filter earlier ranges without a page set;
 * the compact descriptors grow only with the caller's range expression. */
export function* iterateQpdfPageRange(rangeSpec: string, totalPages: number): Generator<number, void, void> {
  const ranges: RangePart[] = [];
  let groupParity: "odd" | "even" | undefined;
  for (const raw of rangeSpec.trim().split(",").filter(part => part.length > 0)) {
    const excluded = raw.startsWith("x");
    let part = (excluded ? raw.slice(1) : raw).trim(), parity: "odd" | "even" | undefined;
    if (part.endsWith(":odd")) { parity = "odd"; part = part.slice(0, -4); }
    else if (part.endsWith(":even")) { parity = "even"; part = part.slice(0, -5); }
    if (part.includes("-")) {
      const [left, right] = part.split("-", 2);
      const first = parseSingleTokenPageNumber(left ?? "1", totalPages), last = parseSingleTokenPageNumber(right ?? "z", totalPages), direction = first <= last ? 1 : -1;
      ranges.push({ first: first + (parity === "even" ? direction : 0), last, step: direction * (parity ? 2 : 1), excluded });
    } else {
      const page = parseSingleTokenPageNumber(part, totalPages);
      ranges.push({ first: page, last: page, step: 1, excluded });
      if (!excluded && parity) groupParity = parity;
    }
  }
  let position = 0;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!; if (range.excluded) continue;
    for (let page = range.first; range.step > 0 ? page <= range.last : page >= range.last; page += range.step) {
      let excluded = false;
      for (let j = i + 1; j < ranges.length; j++) {
        const later = ranges[j]!;
        if (!later.excluded) continue;
        const distance = (page - later.first) / later.step, length = (later.last - later.first) / later.step;
        if (distance >= 0 && distance <= length && Number.isInteger(distance)) { excluded = true; break; }
      }
      if (excluded) continue;
      const keep = groupParity === undefined || position % 2 === (groupParity === "odd" ? 0 : 1);
      position++; if (keep) yield page;
    }
  }
}

/** Buffering convenience API; retained consumers use iterateQpdfPageRange. */
export function parseQpdfPageRange(rangeSpec: string, totalPages: number): number[] {
  return Array.from(iterateQpdfPageRange(rangeSpec, totalPages));
}
