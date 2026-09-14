/** CPython's internal getname table assigns pseudo characters in file order.
 * These names are visible to codecs, but not to unicodedata.name(). */
export function compileCodecNames(aliasText: string, sequenceText: string): {aliases: string[]; sequences: string[]} {
  const aliases: string[] = [], sequences: string[] = [];
  for (const [text, names, field] of [[aliasText, aliases, 1], [sequenceText, sequences, 0]] as const) {
    for (const line of text.split("\n")) {
      const row = line.split("#", 1)[0].trim();
      if (row) names.push(row.split(";")[field].trim());
    }
  }
  if (aliases.length >= 0x200) throw new Error("Unicode aliases overlap named sequences");
  return {aliases, sequences};
}

/** Compile pinned UCD inputs without depending on the build machine's Unicode version. */
export function compileUnicodeNames(derivedNames: string, aliases: string): {
  names: string;
  canonical: number[];
  ranges: Array<[string, number, number]>;
} {
  const names = new Map<string, number>();
  const canonicalNames = new Map<number, string>();
  const ranges: Array<[string, number, number]> = [];
  for (const [input, canonical] of [[derivedNames, true], [aliases, false]] as const) {
    for (const line of input.split("\n")) {
      const row = line.split("#", 1)[0].trim();
      if (!row) continue;
      const [points, name] = row.split(";").map((field) => field.trim());
      const [first, last = first] = points.split("..").map((point) => Number.parseInt(point, 16));
      if (name.endsWith("*")) {
        ranges.push([name.slice(0, -1), first, last]);
      } else {
        const previous = names.get(name);
        if (previous !== undefined && previous !== first) throw new Error(`conflicting Unicode name ${name}`);
        names.set(name, first);
        if (canonical) canonicalNames.set(first, name);
      }
    }
  }
  const offsets = new Map<string, number>();
  let text = "";
  for (const [name, point] of [...names].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    offsets.set(name, text.length);
    text += `${name}=${point.toString(16)}\n`;
  }
  return {
    names: text,
    canonical: [...canonicalNames].sort(([left], [right]) => left - right).flatMap(([point, name]) => [point, offsets.get(name)!]),
    ranges
  };
}

export function compileIdentifierRanges(properties: string): { start: number[]; continue: number[] } {
  const tables: Record<"XID_Start" | "XID_Continue", number[]> = { XID_Start: [], XID_Continue: [] };
  for (const line of properties.split("\n")) {
    const [points, property] = line.split("#", 1)[0].split(";").map((field) => field.trim());
    if (property !== "XID_Start" && property !== "XID_Continue") continue;
    const [first, last = first] = points.split("..").map((point) => Number.parseInt(point, 16));
    const table = tables[property];
    if (table.length && first <= table[table.length - 1] + 1) {
      table[table.length - 1] = Math.max(last, table[table.length - 1]);
    } else {
      table.push(first, last);
    }
  }
  return { start: tables.XID_Start, continue: tables.XID_Continue };
}
