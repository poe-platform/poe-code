interface RangePart { readonly first: number; readonly last: number; readonly step: number; readonly excluded: boolean }

export class QpdfPageRangeError extends Error {}

/** Expand on demand. Later exclusions filter earlier ranges without a page set;
 * the compact descriptors grow only with the caller's range expression. */
export function* iterateQpdfPageRange(rangeSpec: string, totalPages: number, label?: string): Generator<number, void, void> {
  if (rangeSpec.trim().startsWith("x")) {
    throw new QpdfPageRangeError(`error at * in numeric range *${rangeSpec}: first range group may not be an exclusion`);
  }
  const suffix = rangeSpec.indexOf(":");
  if (suffix !== -1 && rangeSpec.includes(",", suffix)) {
    throw new QpdfPageRangeError(`error at * in numeric range ${rangeSpec.slice(0, suffix)}*${rangeSpec.slice(suffix)}: expected :even or :odd`);
  }
  const original = rangeSpec.trim();
  let groupParity: "odd" | "even" | undefined;
  rangeSpec = rangeSpec.trim();
  if (rangeSpec.endsWith(",")) {
    throw new QpdfPageRangeError(`error at * in numeric range ${rangeSpec}*: trailing comma`);
  }
  if (rangeSpec.endsWith(":odd")) { groupParity = "odd"; rangeSpec = rangeSpec.slice(0, -4); }
  else if (rangeSpec.endsWith(":even")) { groupParity = "even"; rangeSpec = rangeSpec.slice(0, -5); }
  const ranges: RangePart[] = [];
  let offset = 0;
  for (const raw of rangeSpec.split(",")) {
    const start = offset;
    offset += raw.length + 1;
    if (!raw) continue;
    function page(token: string): number {
      const trimmed = token.trim();
      if (trimmed === "z") return totalPages;
      const digits = trimmed.startsWith("r") ? trimmed.slice(1) : trimmed;
      if (!digits.length || [...digits].some(char => char < "0" || char > "9")) throw new QpdfPageRangeError(`invalid range syntax: ${token}`);
      const number = trimmed.startsWith("r") ? totalPages + 1 - Number(digits) : Number(digits);
      if (number < 1 || number > totalPages) {
        const context = label === undefined ? "" : `parsing numeric range for ${label}: `;
        throw new QpdfPageRangeError(`${context}error at * in numeric range ${original.slice(0, start)}*${original.slice(start)}: number ${number} out of range`);
      }
      return number;
    }
    const excluded = raw.startsWith("x");
    const part = (excluded ? raw.slice(1) : raw).trim();
    if (part.includes("-")) {
      const separator = part.indexOf("-");
      const first = page(part.slice(0, separator)), last = page(part.slice(separator + 1)), direction = first <= last ? 1 : -1;
      ranges.push({ first, last, step: direction, excluded });
    } else {
      const selected = page(part);
      ranges.push({ first: selected, last: selected, step: 1, excluded });
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
export function parseQpdfPageRange(rangeSpec: string, totalPages: number, label?: string): number[] {
  return Array.from(iterateQpdfPageRange(rangeSpec, totalPages, label));
}
