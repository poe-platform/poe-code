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
