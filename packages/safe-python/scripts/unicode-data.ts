/** Compile pinned UCD inputs without depending on the build machine's Unicode version. */
export function compileUnicodeNames(derivedNames: string, aliases: string): {
  names: string;
  ranges: Array<[string, number, number]>;
} {
  const names = new Map<string, number>();
  const ranges: Array<[string, number, number]> = [];
  for (const input of [derivedNames, aliases]) {
    for (const line of input.split("\n")) {
      const row = line.split("#", 1)[0].trim();
      if (!row) continue;
      const [points, name] = row.split(";").map((field) => field.trim());
      const [first, last = first] = points.split("..").map((point) => Number.parseInt(point, 16));
      if (name.endsWith("*")) {
        // CPython 3.14's unicodedata omits algorithmic Tangut names.
        if (name !== "TANGUT IDEOGRAPH-*") ranges.push([name.slice(0, -1), first, last]);
      } else {
        const previous = names.get(name);
        if (previous !== undefined && previous !== first) throw new Error(`conflicting Unicode name ${name}`);
        names.set(name, first);
      }
    }
  }
  return {
    names: [...names].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, point]) => `${name}=${point.toString(16)}\n`).join(""),
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
