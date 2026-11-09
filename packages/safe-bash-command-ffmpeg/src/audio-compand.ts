import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function compandAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options: Record<string, string> = {
    attacks: "0", decays: "0.8", points: "-70/-70|-60/-20|1/0", "soft-knee": "0.01", gain: "0", volume: "0", delay: "0"
  };
  const names = Object.keys(options);
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    if (!key || !Object.hasOwn(options, key)) throw new Error(`compand: unsupported option ${key}`);
    options[key] = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  const number = (value: string, min = -Infinity, max = Infinity): number => {
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`compand: invalid value ${value}`);
    return parsed;
  };
  const numericOption = (key: string, min: number, max: number): number => {
    const parsed = parseFilterExpression(options[key]!, "compand", {});
    if (parsed < min || parsed > max) throw new Error(`compand: invalid ${key}`);
    return parsed;
  };
  const items = (value: string) => value.split("|").flatMap(part => part.split(" ")).filter(Boolean);
  const attacks = items(options.attacks!).map(value => number(value, 0));
  const decays = items(options.decays!).map(value => number(value, 0));
  if (!attacks.length || !decays.length || Math.min(attacks.length, channels.length) !== Math.min(decays.length, channels.length)) {
    throw new Error("compand: attacks and decays must have matching channel counts");
  }
  const knee = numericOption("soft-knee", 0.01, 900);
  const gain = numericOption("gain", -900, 900);
  const initial = 10 ** (numericOption("volume", -900, 0) / 20);
  if (numericOption("delay", 0, 20) !== 0) throw new Error("compand: nonzero delay is unsupported");
  const points = options.points!.split("|").flatMap(part => part.split(" ")).map(value => {
    const pair = value.split("/");
    if (pair.length !== 2) throw new Error("compand: expected input/output points");
    const x = number(pair[0]!);
    return { x, y: number(pair[1]!) - x };
  });
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.x < points[i - 1]!.x) throw new Error("compand: points must be increasing");
  }
  if (points.at(-1)!.x < 0) points.push({ x: 0, y: 0 });
  points.unshift({ x: points[0]!.x - 2 * knee, y: points[0]!.y });
  for (let i = 2; i < points.length; i++) {
    const [a, b, c] = [points[i - 2]!, points[i - 1]!, points[i]!];
    if ((b.y - a.y) * (c.x - b.x) === (c.y - b.y) * (b.x - a.x)) {
      points.splice(i - 1, 1);
      i--;
    }
  }
  // Work in dB gain space. Round each corner with a quadratic through
  // the incoming edge, the three-point centroid, and the outgoing edge.
  const segments: { x: number; y: number; a: number; b: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!;
    const center = points[i]!;
    const slope = (center.y - previous.y) / (center.x - previous.x);
    segments.push({ ...previous, a: 0, b: slope });
    // FFmpeg rounds the last corner toward an implicit zero-gain point too.
    const next = points[i + 1] ?? { x: 0, y: 0 };
    const incoming = Math.min(knee, Math.hypot(center.x - previous.x, center.y - previous.y));
    const outgoing = Math.min(knee, Math.hypot(next.x - center.x, next.y - center.y) / 2);
    const before = Math.atan2(center.y - previous.y, center.x - previous.x);
    const after = Math.atan2(next.y - center.y, next.x - center.x);
    const x = center.x - incoming * Math.cos(before);
    const y = center.y - incoming * Math.sin(before);
    const endX = center.x + outgoing * Math.cos(after);
    const endY = center.y + outgoing * Math.sin(after);
    const midX = (x + center.x + endX) / 3 - x;
    const midY = (y + center.y + endY) / 3 - y;
    const dx = endX - x;
    const dy = endY - y;
    const a = (dy / dx - midY / midX) / (dx - midX);
    segments.push({ x, y, a, b: midY / midX - a * midX });
    center.x = endX;
    center.y = endY;
  }
  segments.push({ ...points.at(-1)!, a: 0, b: 0 });
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  const coefficient = (seconds: number) => seconds <= 1 / sampleRate ? 1 : -Math.expm1(-1 / (sampleRate * seconds));
  for (let c = 0; c < channels.length; c++) {
    const attack = coefficient(attacks[Math.min(c, attacks.length - 1)]!);
    const decay = coefficient(decays[Math.min(c, decays.length - 1)]!);
    let envelope = initial;
    for (let i = 0; i < length; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const sample = channels[c]![i]!;
      const delta = Math.abs(sample) - envelope;
      envelope += delta * (delta > 0 ? attack : decay);
      const db = Math.max(segments[0]!.x, 20 * Math.log10(envelope));
      // The final knee can turn back toward 0 dB: use the first boundary,
      // as FFmpeg does, rather than assuming the segments remain sorted.
      let index = 0;
      while (index + 1 < segments.length && segments[index + 1]!.x < db) index++;
      const segment = segments[index]!;
      const offset = db - segment.x;
      output[c]![i] = sample * 10 ** ((gain + segment.y + offset * (segment.a * offset + segment.b)) / 20);
    }
  }
  return output;
}
