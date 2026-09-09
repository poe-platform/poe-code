/** Compile decomposition, combining-class, and canonical-composition tables. */
export function compileNormalizationData(unicodeData: string, normalizationProperties: string): {
  decompositions: Record<number, number[]>;
  combiningClasses: Record<number, number>;
  compositions: Record<number, number>;
} {
  const excluded = new Set<number>();
  for (const line of normalizationProperties.split("\n")) {
    const [range, property] = line.split("#", 1)[0].split(";").map(field => field.trim());
    if (property !== "Full_Composition_Exclusion") continue;
    const [first, last = first] = range.split("..").map(point => Number.parseInt(point, 16));
    for (let point = first; point <= last; point++) excluded.add(point);
  }
  const decompositions: Record<number, number[]> = {};
  const combiningClasses: Record<number, number> = {};
  const compositions: Record<number, number> = {};
  for (const line of unicodeData.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split(";");
    const point = Number.parseInt(fields[0], 16);
    const combining = Number(fields[3]);
    if (combining) combiningClasses[point] = combining;
    if (!fields[5]) continue;
    const parts = fields[5].split(" ");
    const compatibility = parts[0].startsWith("<");
    if (compatibility) parts.shift();
    const decomposition = parts.map(part => Number.parseInt(part, 16));
    decompositions[point] = decomposition;
    if (!compatibility && decomposition.length === 2 && !excluded.has(point)) {
      compositions[decomposition[0] * 0x110000 + decomposition[1]] = point;
    }
  }
  return { decompositions, combiningClasses, compositions };
}
