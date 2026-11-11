import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { parseFilterExpression } from "./filter-expression.js";

export function setPacketTimestamps(tracks: readonly MediaTrack[], filter: string, type: "audio" | "video" | "subtitle", budget: MediaBudgetTracker, movieTimescale: number): readonly MediaTrack[] {
  const expressions: Record<string, string> = { ts: "TS", duration: "DURATION" };
  if (filter !== "setts") for (const [index, option] of filter.slice(6).split(":").entries()) {
    const equals = option.indexOf("=");
    const key = equals < 0 && index === 0 ? "ts" : option.slice(0, equals);
    const value = equals < 0 ? option : option.slice(equals + 1);
    if (!["ts", "pts", "dts", "duration"].includes(key) || !value) throw new Error(`Invalid setts bitstream filter option: ${option}`);
    expressions[key] = value;
  }
  const variables = { N: 0, TS: 0, PTS: 0, DTS: 0, DURATION: 1, STARTPTS: 0, STARTDTS: 0, TB: 1, SR: 48000 };
  for (const expression of Object.values(expressions)) parseFilterExpression(expression, "setts bitstream filter", variables);
  return tracks.map(track => {
    if (track.type !== type) return track;
    let delay = 0;
    for (const edit of track.editList ?? []) {
      if (edit.mediaTime >= 0) break;
      delay += edit.segmentDuration * track.timescale / movieTimescale;
    }
    const offset = Math.round(delay) - (track.editList?.find(edit => edit.mediaTime >= 0)?.mediaTime ?? 0) - Math.min(0, track.samples[0]?.dts ?? 0);
    const samples = track.samples.map((original, N) => {
      const sample = { ...original, pts: original.pts + offset, dts: original.dts + offset };
      budget.checkCpu();
      const values = { ...variables, N, PTS: sample.pts, DTS: sample.dts, DURATION: sample.duration,
        STARTPTS: track.samples[0]!.pts + offset, STARTDTS: track.samples[0]!.dts + offset,
        TB: 1 / track.timescale, SR: track.codecDescriptions[0]?.sampleRate ?? 0 };
      const evaluate = (expression: string, TS: number) => {
        const result = parseFilterExpression(expression, "setts bitstream filter", { ...values, TS });
        // FFmpeg uses lrint: round to nearest, with ties going to the even integer.
        const floor = Math.floor(result);
        const value = result - floor === 0.5 ? floor + Math.abs(floor % 2) : Math.round(result);
        if (!Number.isSafeInteger(value)) throw new Error("setts bitstream filter: timestamp out of range");
        return value;
      };
      const dts = evaluate(expressions.dts ?? expressions.ts!, sample.dts);
      const pts = expressions.pts === undefined ? evaluate(expressions.ts!, sample.dts) : evaluate(expressions.pts, sample.pts);
      const duration = evaluate(expressions.duration!, sample.dts);
      if (duration < 0) throw new Error("setts bitstream filter: negative duration");
      return { ...sample, dts, pts, cts: pts - dts, duration };
    });
    const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
    // Replace source edits so the muxer cannot clip packets to the old presentation interval.
    const editList = [{ segmentDuration: Math.round(duration * movieTimescale / track.timescale),
      mediaTime: Math.max(0, -(samples[0]?.dts ?? 0)), mediaRateInteger: 1, mediaRateFraction: 0 }];
    return { ...track, samples, duration, editList };
  });
}
