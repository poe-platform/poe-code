// FFmpeg's curve enum runs from nofade (-1) through hsin2 (22).
export const audioFadeCurves: Record<string, (gain: number) => number> = {
  nofade: () => 1,
  tri: gain => gain,
  qsin: gain => Math.sin(gain * Math.PI / 2),
  esin: gain => 1 - Math.cos(Math.PI / 4 * ((2 * gain - 1) ** 3 + 1)),
  hsin: gain => (1 - Math.cos(gain * Math.PI)) / 2,
  log: gain => Math.max(0, Math.min(1, 1 + 0.2 * Math.log10(gain))),
  ipar: gain => 1 - (1 - gain) * (1 - gain),
  qua: gain => gain * gain,
  cub: gain => gain * gain * gain,
  squ: Math.sqrt,
  cbr: Math.cbrt,
  par: gain => 1 - Math.sqrt(1 - gain),
  exp: gain => Math.exp(-11.512925464970227 * (1 - gain)),
  iqsin: gain => 0.6366197723675814 * Math.asin(gain),
  ihsin: gain => 0.3183098861837907 * Math.acos(1 - 2 * gain),
  dese: gain => gain <= 0.5 ? Math.cbrt(2 * gain) / 2 : 1 - Math.cbrt(2 * (1 - gain)) / 2,
  desi: gain => {
    const x = 2 * (gain <= 0.5 ? gain : 1 - gain);
    // Match native cubic multiplication; exponentiation changes PCM truncation.
    const cube = x * x * x / 2;
    return gain <= 0.5 ? cube : 1 - cube;
  },
  losi: gain => {
    const a = 1 / (1 - 0.787) - 1;
    const low = 1 / (1 + Math.exp(a));
    const high = 1 / (1 + Math.exp(-a));
    return (1 / (1 + Math.exp(-(gain - 0.5) * a * 2)) - low) / (high - low);
  },
  sinc: gain => gain >= 1 ? 1 : Math.sin(Math.PI * (1 - gain)) / (Math.PI * (1 - gain)),
  isinc: gain => gain <= 0 ? 0 : 1 - Math.sin(Math.PI * gain) / (Math.PI * gain),
  quat: gain => gain * gain * gain * gain,
  quatr: gain => gain ** 0.25,
  qsin2: gain => Math.sin(gain * Math.PI / 2) ** 2,
  hsin2: gain => ((1 - Math.cos(gain * Math.PI)) / 2) ** 2
};
