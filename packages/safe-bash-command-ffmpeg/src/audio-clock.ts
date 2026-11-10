import { parseFilterExpression } from "./filter-expression.js";

export function createAudioTimestampTransform(expression: string, rate: number, timeBase: number) {
  const samplesPerTick = timeBase * rate;
  const toTicks = (pts: number) => Math.sign(pts) * Math.round(Math.abs(pts) / samplesPerTick);
  let startPts: number | undefined;
  let previousOutputPts = NaN;
  let previousInputPts = NaN;
  return (frame: { start: number; end: number; pts: number; pos?: number | undefined }): number => {
    startPts ??= frame.pts;
    const pts = Math.trunc(parseFilterExpression(expression, "asetpts", {
      POS: frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN,
      NAN: NaN, PTS: toTicks(frame.pts), STARTPTS: toTicks(startPts), STARTT: startPts / rate,
      T: frame.pts / rate, TB: timeBase, SR: rate, INTERLACED: 0,
      FR: NaN, FRAME_RATE: NaN,
      PREV_INPTS: toTicks(previousInputPts), PREV_INT: previousInputPts / rate,
      N: frame.start, NB_CONSUMED_SAMPLES: frame.start,
      NB_SAMPLES: frame.end - frame.start, S: frame.end - frame.start,
      PREV_OUTPTS: toTicks(previousOutputPts), PREV_OUTT: previousOutputPts / rate
    })) * samplesPerTick;
    previousInputPts = frame.pts;
    previousOutputPts = pts;
    return pts;
  };
}
