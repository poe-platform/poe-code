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
  for (const value of values) {
    const relative = value.startsWith("+");
    const raw = relative ? value.slice(1) : value;
    // Native sample counts consume a decimal integer prefix, not an expression.
    const point = timestamps ? parseHlsDuration(raw) : Number.parseInt(raw, 10);
    const absolute = point + (relative ? previous : 0);
    if (!raw || !Number.isFinite(absolute) || (!timestamps && !Number.isSafeInteger(absolute))) {
      throw new Error("asegment: invalid split point");
    }
    previous = point;
    // Once a segment ends, subsequent points cannot rewind the input.
    points.push(Math.max(points.at(-1) ?? (timestamps ? -Infinity : 0), absolute));
  }
  const suffix = timestamps ? "" : "_sample";
  return Array.from({ length: points.length + 1 }, (_, index) => {
    const bounds: string[] = [];
    if (index > 0) bounds.push(`start${suffix}=${points[index - 1]}`);
    if (index < points.length) bounds.push(`end${suffix}=${points[index]}`);
    return `atrim=${bounds.join(":")}`;
  });
}
