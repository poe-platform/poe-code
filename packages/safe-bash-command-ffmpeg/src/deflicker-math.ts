const f = Math.fround;
const bits = new DataView(new ArrayBuffer(4));
const factors = [1 / 1.5874010519681996, 1 / 1.2599210498948732, 1, 1.2599210498948732, 1.5874010519681996];

// glibc 2.19 s_cbrtf.c, Copyright (C) 1997-2014 Free Software Foundation,
// Inc., LGPL-2.1-or-later. Keep the native mix of float and double operations.
// https://github.com/bminor/glibc/blob/glibc-2.19/sysdeps/ieee754/flt-32/s_cbrtf.c
export function deflickerCubeRoot(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const exponent = Math.floor(Math.log2(value)) + 1;
  const mantissa = value / 2 ** exponent;
  const root = f(0.49265962052896956 + (0.6975704602079228 - 0.19150216167871906 * mantissa) * mantissa);
  const cube = f(f(root * root) * root);
  const refined = f(root * (cube + 2 * mantissa) / (2 * cube + mantissa) * factors[2 + exponent % 3]!);
  return f(refined * 2 ** Math.trunc(exponent / 3));
}

// glibc 2.28 e_powf.c, e_powf_log2_data.c and e_exp2f_data.c.
// Copyright (C) 2017-2018 Free Software Foundation, Inc., LGPL-2.1-or-later.
// https://github.com/bminor/glibc/tree/glibc-2.28/sysdeps/ieee754/flt-32
const logTable = [
  [1.398907162146528, -0.48430022186289673],
  [1.3403141896637998, -0.42257122959194704],
  [1.286432210124115, -0.3633754347673556],
  [1.2367150214269895, -0.30651309567405577],
  [1.1906977166711752, -0.25180720160537634],
  [1.1479821020556429, -0.19910014943794563],
  [1.1082251448272158, -0.14825100623281615],
  [1.0711297413057381, -0.09913323807318392],
  [1.036437278977283, -0.051632812977629436],
  [1.0, 0.0],
  [0.9492859795739057, 0.07508531937943004],
  [0.8951049428609004, 0.15987125980713107],
  [0.8476821620351103, 0.2384046664317681],
  [0.8050314851692001, 0.31288288605863257],
  [0.7664671008843108, 0.38370422656453185],
  [0.731428603316328, 0.451211048935815]
] as const;
const expTable = [
  1.0, 1.0218971486541166, 1.0442737824274138, 1.0671404006768237,
  1.0905077326652577, 1.1143867425958924, 1.1387886347566916, 1.1637248587775775,
  1.189207115002721, 1.215247359980469, 1.241857812073484, 1.2690509571917332,
  1.2968395546510096, 1.3252366431597413, 1.3542555469368927, 1.383909881963832,
  1.4142135623730951, 1.4451808069770467, 1.4768261459394993, 1.5091644275934228,
  1.5422108254079407, 1.5759808451078865, 1.6104903319492543, 1.645755478153965,
  1.681792830507429, 1.718619298122478, 1.7562521603732995, 1.7947090750031072,
  1.8340080864093424, 1.8741676341103, 1.9152065613971474, 1.9571441241754002
];

// Only nonnegative luminance and positive exponents (size or 1/size) occur.
// powf's approximation differs from rounding Math.pow, even at integer powers.
export function deflickerPower(x: number, y: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  bits.setFloat32(0, x);
  let ix = bits.getInt32(0);
  if (ix < 0x00800000) {
    bits.setFloat32(0, x * 2 ** 23);
    ix = bits.getInt32(0) - (23 << 23);
  }
  const offset = ix - 0x3f330000;
  const index = (offset >>> 19) % 16;
  const top = offset & 0xff800000;
  bits.setInt32(0, ix - top);
  const [inverse, log] = logTable[index]!;
  const r = bits.getFloat32(0) * inverse - 1;
  const rr = r * r;
  const logx = (0.288457581109214 * r - 0.36092606229713164) * (rr * rr) +
    ((0.480898481472577 * r - 0.7213474675006291) * rr + (1.4426950408774342 * r + (log + (top >> 23))));
  const exponent = y * logx;
  if (exponent > 127.99999995700433) return Infinity;
  if (exponent <= -150) return 0;
  // Adding and subtracting the shift rounds to the nearest multiple of 1/32.
  const shift = 1.5 * 2 ** 47;
  const rounded = (exponent + shift) - shift;
  const k = rounded * 32;
  const remainder = exponent - rounded;
  const scale = expTable[((k % 32) + 32) % 32]! * 2 ** Math.floor(k / 32);
  return f(((0.05550361559341535 * remainder + 0.2402284522445722) * (remainder * remainder) +
    (0.6931471806916203 * remainder + 1)) * scale);
}
