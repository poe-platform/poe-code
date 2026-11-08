// Split one level of FFmpeg's escaped/quoted tee syntax.
function split(value: string, separator: string, preserveQuotes = false): string[] {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (char === "\\" && i + 1 < value.length) {
      const next = value[++i]!;
      part += preserveQuotes && next !== separator ? `\\${next}` : next;
    } else if (char === "'") {
      quoted = !quoted;
      if (preserveQuotes) part += char;
    } else if (char === separator && !quoted) {
      parts.push(part);
      part = "";
    } else part += char;
  }
  if (quoted) throw new Error("Unterminated tee quote");
  parts.push(part);
  return parts;
}

export function parseTee(target: string) {
  return split(target, "|", true).map(destination => {
    const options: Record<string, string> = {};
    if (destination.startsWith("[")) {
      const end = destination.indexOf("]");
      if (end < 0) throw new Error("Unterminated tee options");
      for (const option of split(destination.slice(1, end), ":")) {
        const equals = option.indexOf("=");
        const key = option.slice(0, equals);
        if (equals < 0 || !["f", "select", "onfail"].includes(key)) throw new Error(`Unsupported tee option '${option}'`);
        options[key] = option.slice(equals + 1);
      }
      destination = destination.slice(end + 1);
    }
    if (!destination) throw new Error("Empty tee destination");
    if (options.onfail && !["ignore", "abort"].includes(options.onfail)) throw new Error(`Invalid tee onfail '${options.onfail}'`);
    return { target: destination, format: options.f, select: options.select, ignore: options.onfail === "ignore" };
  });
}

export function selectTeeTracks<T extends { type: string }>(tracks: readonly T[], select: string | undefined): readonly T[] {
  if (select === undefined) return tracks;
  const selected = new Set<T>();
  for (const spec of select.split(",")) {
    const [kind, ordinal, ...extra] = spec.split(":");
    const type = ({ a: "audio", v: "video", s: "subtitle", d: "data" } as Record<string, string>)[kind!];
    const index = type ? ordinal : kind;
    if (extra.length || (!type && ordinal !== undefined) || (index !== undefined && (index === "" || !Number.isInteger(Number(index)) || Number(index) < 0))) {
      throw new Error(`Invalid tee stream specifier '${spec}'`);
    }
    const candidates = type ? tracks.filter(track => track.type === type) : tracks;
    for (const [i, track] of candidates.entries()) if (index === undefined || i === Number(index)) selected.add(track);
  }
  return tracks.filter(track => selected.has(track));
}
