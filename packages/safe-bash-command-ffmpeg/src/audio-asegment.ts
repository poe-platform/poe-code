import { parseHlsDuration } from "safe-bash-command-ffprobe/media";

export function parseAudioSegment(filter: string): string[] {
  const equals = filter.indexOf("=");
  const options = new Map<string, string>();
  const arguments_ = equals < 0 ? [] : filter.slice(equals + 1).split(":");
  if (arguments_.at(-1) === "") arguments_.pop();
  for (const [index, option] of arguments_.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["timestamps", "samples"][index] : option.slice(0, separator).trim();
    if (key !== "timestamps" && key !== "samples") throw new Error("asegment: unsupported option");
    options.set(key, (separator < 0 ? option : option.slice(separator + 1)).trim());
  }
  if (options.size !== 1) throw new Error("asegment: supply either timestamps or samples");
  const timestamps = options.has("timestamps");
  const values = options.get(timestamps ? "timestamps" : "samples")!.split("|");
  const points: number[] = [];
  let previous = 0;
  let previousSample = 0n;
  for (const value of values) {
    const relative = value.startsWith("+");
    const raw = relative ? value.slice(1) : value;
    let absolute: number;
    if (timestamps) {
      const point = parseHlsDuration(raw);
      absolute = point + (relative ? previous : 0);
      previous = point;
    } else {
      // Native sample counts consume a decimal integer prefix, not an expression.
      const integer = raw.trimStart().match(/^[+-]?\d+/)?.[0];
      if (!integer) throw new Error("asegment: invalid split point");
      const point = BigInt(integer);
      const sample = point + (relative ? previousSample : 0n);
      if (point < -9223372036854775808n || point > 9223372036854775807n ||
          sample < -9223372036854775808n || sample > 9223372036854775807n) {
        throw new Error("asegment: invalid split point");
      }
      previousSample = point;
      // The bounded in-memory input cannot reach an unsafe integer index.
      absolute = Number(sample > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : sample);
    }
    if (!raw || !Number.isFinite(absolute)) {
      throw new Error("asegment: invalid split point");
    }
    // Once a segment ends, subsequent points cannot rewind the input.
    points.push(Math.max(points.at(-1) ?? (timestamps ? -Infinity : 0), absolute));
  }
  const suffix = timestamps ? "" : "_sample";
  return Array.from({ length: points.length + 1 }, (_, index) => {
    const bounds: string[] = [];
    if (index > 0) bounds.push(`start${suffix}=${points[index - 1]}`);
    if (index < points.length) bounds.push(`end${suffix}=${points[index]}`);
    return `${timestamps ? "asegment" : "atrim"}=${bounds.join(":")}`;
  });
}

export function createAudioSegmentTrim(start: number, end: number, samplesPerTick: number) {
  const points = start === Infinity ? [end] : [start, end];
  const selected = points.length - 1;
  let segment = 0;
  return (frame: { start: number; end: number; pts: number }) => {
    let from: number | undefined;
    let to = 0;
    const count = frame.end - frame.start;
    // Match native consumption: cap each frame by the remaining sample count,
    // then advance on its timestamp. Neither clock can rewind the segment.
    for (let offset = 0; offset < count;) {
      while (segment < points.length && points[segment]! <= frame.start + offset) segment++;
      if (segment >= points.length) break;
      const remaining = points[segment]! - frame.start - offset;
      const limit = Math.round(remaining / samplesPerTick);
      const consumed = limit > 0 && limit <= 2147483647 ? Math.min(count - offset, limit) : count - offset;
      const pts = Math.round(frame.pts / samplesPerTick) + Math.round(offset / samplesPerTick);
      while (segment < points.length && pts >= points[segment]!) segment++;
      if (segment === selected) {
        from ??= offset;
        to = offset + consumed;
      }
      offset += consumed;
    }
    return from !== undefined ? { start: from, end: to } : segment >= points.length ? null : undefined;
  };
}
