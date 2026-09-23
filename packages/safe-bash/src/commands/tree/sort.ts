/** C-locale version ordering, without converting digit runs to numbers. */
export function compareVersions(left: Uint8Array, right: Uint8Array): number {
  const digit = (byte: number | undefined): boolean => byte !== undefined && byte >= 48 && byte <= 57;
  let state: "normal" | "integer" | "fraction" | "zeros" = "normal";
  let index = 0;
  while (index < left.length && left[index] === right[index]) {
    const byte = left[index++]!;
    if (!digit(byte)) state = "normal";
    else if (state === "normal") state = byte === 48 ? "zeros" : "integer";
    else if (state === "zeros" && byte !== 48) state = "fraction";
  }
  const a = left[index] ?? 0;
  const b = right[index] ?? 0;
  const difference = a - b;
  if (!difference) return 0;
  if (state === "zeros") {
    if (!digit(a) && digit(b)) return 1;
    if (digit(a) && !digit(b)) return -1;
  }
  if (state === "integer") {
    if (digit(a) && !digit(b)) return 1;
    if (!digit(a) && digit(b)) return -1;
  }
  if (digit(a) && digit(b) && (state === "integer" || (state !== "zeros" && a !== 48 && b !== 48))) {
    let endA = index + 1;
    let endB = index + 1;
    while (digit(left[endA])) endA++;
    while (digit(right[endB])) endB++;
    if (endA !== endB) return endA - endB;
  }
  return difference;
}
