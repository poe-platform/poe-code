const cubeRootFactors = [1 / 1.5874010519681996, 1 / 1.2599210498948732, 1, 1.2599210498948732, 1.5874010519681996];

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
  cbr: gain => {
    if (gain === 0) return 0;
    // Match the glibc cube root used by FFmpeg 7.0.2-static. Math.cbrt's
    // different rounding becomes a whole PCM unit when samples are truncated.
    // Polynomial/refinement: glibc s_cbrt.c, Copyright (C) 1997-2014
    // Free Software Foundation, Inc., LGPL-2.1-or-later.
    // https://github.com/bminor/glibc/blob/glibc-2.19/sysdeps/ieee754/dbl-64/s_cbrt.c
    let exponent = Math.floor(Math.log2(gain)) + 1;
    let mantissa = gain / 2 ** exponent;
    // log2 can round up at the value immediately below a power of two.
    if (mantissa < 0.5) { mantissa *= 2; exponent--; }
    const root = 0.35489576504391984 + mantissa * (1.508191937815849 + mantissa *
      (-2.114994941673713 + mantissa * (2.4469312256353444 + mantissa *
      (-1.8346927748361308 + mantissa * (0.7849323449766392 - 0.14526389938548637 * mantissa)))));
    const cube = root * root * root;
    const factor = cubeRootFactors[2 + exponent % 3]!;
    return root * (cube + 2 * mantissa) / (2 * cube + mantissa) * factor * 2 ** Math.trunc(exponent / 3);
  },
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
