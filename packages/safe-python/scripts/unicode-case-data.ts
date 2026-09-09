type CaseMappings = Record<"upper" | "casefold", Record<number, number[]>>;

/** Unicode default full casing is locale-independent. Conditional casing rows
 * and Turkic folding are deliberately not part of these two transformations. */
export function compileCaseMappings(unicodeData: string, specialCasing: string, caseFolding: string): CaseMappings {
  const result: CaseMappings = { upper: {}, casefold: {} };
  for (const line of unicodeData.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split(";");
    if (fields[12]) result.upper[codePoint(fields[0])] = [codePoint(fields[12])];
  }
  for (const line of specialCasing.split("\n")) {
    const row = line.split("#", 1)[0].trim();
    if (!row) continue;
    const fields = row.split(";").map(field => field.trim());
    if (fields[4]) continue;
    result.upper[codePoint(fields[0])] = fields[3].split(" ").filter(Boolean).map(codePoint);
  }
  for (const line of caseFolding.split("\n")) {
    const row = line.split("#", 1)[0].trim();
    if (!row) continue;
    const fields = row.split(";").map(field => field.trim());
    if (fields[1] !== "C" && fields[1] !== "F") continue;
    result.casefold[codePoint(fields[0])] = fields[2].split(" ").filter(Boolean).map(codePoint);
  }
  for (const table of Object.values(result)) {
    for (const [point, mapping] of Object.entries(table)) {
      if (mapping.length === 1 && mapping[0] === Number(point)) delete table[Number(point)];
    }
  }
  return result;
}

function codePoint(encoded: string): number {
  const point = Number(`0x${encoded}`);
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) throw new Error("invalid Unicode case code point");
  return point;
}
