import { HashMD } from "@noble/hashes/_md.js";
import { createHasher, rotl } from "@noble/hashes/utils.js";

// RIPEMD round schedules and constants from the algorithm specification:
// https://homes.esat.kuleuven.be/~bosselae/ripemd160.html
const leftWords = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13
];
const rightWords = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11
];
const leftShifts = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6
];
const rightShifts = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11
];
const leftConstants = [0, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const rightConstants = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0];

function mix(round: number, x: number, y: number, z: number): number {
  switch (round) {
    case 0: return x ^ y ^ z;
    case 1: return (x & y) | (~x & z);
    case 2: return (x | ~y) ^ z;
    case 3: return (x & z) | (y & ~z);
    default: return x ^ (y | ~z);
  }
}

class Ripemd extends HashMD<Ripemd> {
  private state: number[];
  private words = new Uint32Array(16);

  constructor(private bits: 128 | 256 | 320) {
    super(64, bits / 8, 8, true);
    this.state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    if (bits === 320) this.state.push(0xc3d2e1f0);
    if (bits !== 128) this.state.push(0x76543210, 0xfedcba98, 0x89abcdef, 0x01234567);
    if (bits === 320) this.state.push(0x3c2d1e0f);
  }

  protected get(): number[] { return this.state; }
  protected set(...state: number[]): void { this.state = state; }
  protected roundClean(): void { this.words.fill(0); }

  _cloneInto(to = new Ripemd(this.bits)): Ripemd {
    to.set(...this.state);
    return this._cloneIntoMeta(to);
  }

  destroy(): void {
    this.destroyed = true;
    this.buffer.fill(0);
    this.state.fill(0);
    this.words.fill(0);
  }

  protected process(view: DataView, offset: number): void {
    const wide = this.bits === 320;
    const rounds = wide ? 5 : 4;
    const h = this.state;
    const right = this.bits === 128 ? 0 : rounds;
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = wide ? h[4]! : 0;
    let aa = h[right]!, bb = h[right + 1]!, cc = h[right + 2]!, dd = h[right + 3]!, ee = wide ? h[9]! : 0;
    for (let i = 0; i < 16; i++) this.words[i] = view.getUint32(offset + i * 4, true);
    for (let round = 0; round < rounds; round++) {
      for (let i = round * 16; i < (round + 1) * 16; i++) {
        const l = rotl(a + mix(round, b, c, d) + this.words[leftWords[i]!]! + leftConstants[round]!, leftShifts[i]!);
        const r = rotl(aa + mix(rounds - 1 - round, bb, cc, dd) + this.words[rightWords[i]!]! +
          (round === rounds - 1 ? 0 : rightConstants[round]!), rightShifts[i]!);
        if (wide) {
          a = e; e = d; d = rotl(c, 10); c = b; b = (l + a) | 0;
          aa = ee; ee = dd; dd = rotl(cc, 10); cc = bb; bb = (r + aa) | 0;
        } else {
          a = d; d = c; c = b; b = l;
          aa = dd; dd = cc; cc = bb; bb = r;
        }
      }
      if (this.bits !== 128) {
        // The extended digests exchange one lane register after each round.
        const swap = wide ? [1, 3, 0, 2, 4][round] : round;
        switch (swap) {
          case 0: [a, aa] = [aa, a]; break;
          case 1: [b, bb] = [bb, b]; break;
          case 2: [c, cc] = [cc, c]; break;
          case 3: [d, dd] = [dd, d]; break;
          case 4: [e, ee] = [ee, e]; break;
        }
      }
    }
    if (this.bits === 128) {
      this.set((h[1]! + c + dd) | 0, (h[2]! + d + aa) | 0,
        (h[3]! + a + bb) | 0, (h[0]! + b + cc) | 0);
    } else {
      const result = wide ? [a, b, c, d, e, aa, bb, cc, dd, ee] : [a, b, c, d, aa, bb, cc, dd];
      for (let i = 0; i < h.length; i++) h[i] = (h[i]! + result[i]!) | 0;
    }
  }
}

export const ripemd128 = createHasher(() => new Ripemd(128));
export const ripemd256 = createHasher(() => new Ripemd(256));
export const ripemd320 = createHasher(() => new Ripemd(320));
