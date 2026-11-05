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

export class QpdfPageRangeError extends Error {}

/** Expand on demand. Later exclusions filter earlier ranges without a page set;
 * the compact descriptors grow only with the caller's range expression. */
export function* iterateQpdfPageRange(rangeSpec: string, totalPages: number): Generator<number, void, void> {
  if (rangeSpec.trim().startsWith("x")) {
    throw new QpdfPageRangeError(`error at * in numeric range *${rangeSpec}: first range group may not be an exclusion`);
  }
  const suffix = rangeSpec.indexOf(":");
  if (suffix !== -1 && rangeSpec.includes(",", suffix)) {
    throw new QpdfPageRangeError(`error at * in numeric range ${rangeSpec.slice(0, suffix)}*${rangeSpec.slice(suffix)}: expected :even or :odd`);
  }
  let groupParity: "odd" | "even" | undefined;
  rangeSpec = rangeSpec.trim();
  if (rangeSpec.endsWith(",")) {
    throw new QpdfPageRangeError(`error at * in numeric range ${rangeSpec}*: trailing comma`);
  }
  if (rangeSpec.endsWith(":odd")) { groupParity = "odd"; rangeSpec = rangeSpec.slice(0, -4); }
  else if (rangeSpec.endsWith(":even")) { groupParity = "even"; rangeSpec = rangeSpec.slice(0, -5); }
  const ranges: RangePart[] = [];
  for (const raw of rangeSpec.trim().split(",").filter(part => part.length > 0)) {
    const excluded = raw.startsWith("x");
    const part = (excluded ? raw.slice(1) : raw).trim();
    if (part.includes("-")) {
      const [left, right] = part.split("-", 2);
      const first = parseSingleTokenPageNumber(left ?? "1", totalPages), last = parseSingleTokenPageNumber(right ?? "z", totalPages), direction = first <= last ? 1 : -1;
      ranges.push({ first, last, step: direction, excluded });
    } else {
      const page = parseSingleTokenPageNumber(part, totalPages);
      ranges.push({ first: page, last: page, step: 1, excluded });
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
