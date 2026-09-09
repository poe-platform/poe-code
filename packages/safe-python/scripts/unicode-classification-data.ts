type ClassificationData = Record<"alpha" | "decimal" | "digit" | "numeric" | "printable", number[]>;
type Range = [number, number];

/** Compile category and derived numeric properties from pinned UCD inputs.
 * DerivedNumericType includes Unihan numeric values absent from UnicodeData. */
export function compileClassificationData(unicodeData: string, numericTypes: string): ClassificationData {
  const ranges: Record<keyof ClassificationData, Range[]> = { alpha: [], decimal: [], digit: [], numeric: [], printable: [[32, 32]] };
  let pending: { first: number; name: string; category: string } | undefined;
  for (const line of unicodeData.split("\n")) {
    if (!line.trim()) continue;
    const [encoded, name, category] = line.split(";");
    const last = codePoint(encoded);
    let first = last;
    if (name.endsWith(", First>")) {
      if (pending) throw new Error("incomplete Unicode category range");
      pending = { first, name: name.slice(0, -8), category }; continue;
    }
    if (name.endsWith(", Last>")) {
      if (!pending || pending.name !== name.slice(0, -7) || pending.category !== category || pending.first > last) throw new Error("inconsistent Unicode category range");
      first = pending.first; pending = undefined;
    } else if (pending) throw new Error("incomplete Unicode category range");
    if (category.startsWith("L")) ranges.alpha.push([first, last]);
    if ("LMNPS".includes(category[0])) ranges.printable.push([first, last]);
  }
  if (pending) throw new Error("incomplete Unicode category range");
  for (const line of numericTypes.split("\n")) {
    const [encoded, kind] = line.split("#", 1)[0].split(";").map(field => field.trim());
    if (kind !== "Decimal" && kind !== "Digit" && kind !== "Numeric") continue;
    const parts = encoded.split("..");
    if (parts.length > 2) throw new Error("invalid Unicode numeric range");
    const first = codePoint(parts[0]), last = codePoint(parts[1] ?? parts[0]);
    if (first > last) throw new Error("invalid Unicode numeric range");
    ranges.numeric.push([first, last]);
    if (kind !== "Numeric") ranges.digit.push([first, last]);
    if (kind === "Decimal") ranges.decimal.push([first, last]);
  }
  const result: ClassificationData = { alpha: [], decimal: [], digit: [], numeric: [], printable: [] };
  for (const kind of Object.keys(ranges) as Array<keyof ClassificationData>) {
    const target = result[kind];
    for (const [first, last] of ranges[kind].sort((a, b) => a[0] - b[0])) {
      if (target.length && first <= target[target.length - 1] + 1) target[target.length - 1] = Math.max(last, target[target.length - 1]);
      else target.push(first, last);
    }
  }
  return result;
}

function codePoint(encoded: string): number {
  const point = Number(`0x${encoded}`);
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) throw new Error("invalid Unicode code point");
  return point;
}
