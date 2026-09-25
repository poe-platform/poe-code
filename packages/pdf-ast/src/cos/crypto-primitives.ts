function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// --- MD5 (RFC 1321) ---
const MD5_S = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

export function md5Bytes(chunks: readonly Uint8Array[]): Uint8Array {
  const msg = concatChunks(chunks);
  const bitLen = msg.length * 8;
  const padLen = ((56 - ((msg.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(msg.length + 1 + padLen + 8);
  buf.set(msg, 0);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, bitLen >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);
  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let j = 0; j < 16; j++) {
      M[j] = dv.getUint32(offset + j * 4, true);
    }
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const temp = D;
      D = C;
      C = B;
      const sum = (A + F + MD5_K[i]! + M[g]!) >>> 0;
      const s = MD5_S[i]!;
      B = (B + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
      A = temp;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, a0, true);
  outDv.setUint32(4, b0, true);
  outDv.setUint32(8, c0, true);
  outDv.setUint32(12, d0, true);
  return out;
}

// --- SHA-256 (FIPS 180-4) ---
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Bytes(chunks: readonly Uint8Array[]): Uint8Array {
  const msg = concatChunks(chunks);
  const bitLen = msg.length * 8;
  const padLen = ((56 - ((msg.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(msg.length + 1 + padLen + 8);
  buf.set(msg, 0);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
  dv.setUint32(buf.length - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const W = new Uint32Array(64);
  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = dv.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(W[i - 15]!, 7) ^ rotr32(W[i - 15]!, 18) ^ (W[i - 15]! >>> 3);
      const s1 = rotr32(W[i - 2]!, 17) ^ rotr32(W[i - 2]!, 19) ^ (W[i - 2]! >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i]! + W[i]!) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  outDv.setUint32(20, h5, false);
  outDv.setUint32(24, h6, false);
  outDv.setUint32(28, h7, false);
  return out;
}

// --- SHA-384 / SHA-512 (FIPS 180-4) ---
const SHA512_K: readonly bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];
const MASK64 = 0xffffffffffffffffn;

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | ((x << (64n - n)) & MASK64)) & MASK64;
}

function sha512Core(msg: Uint8Array, iv: readonly bigint[], outLenBytes: number): Uint8Array {
  const bitLen = BigInt(msg.length) * 8n;
  const padLen = ((112 - ((msg.length + 1) % 128)) + 128) % 128;
  const buf = new Uint8Array(msg.length + 1 + padLen + 16);
  buf.set(msg, 0);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(buf.length - 16, 0n, false);
  dv.setBigUint64(buf.length - 8, bitLen, false);

  let [h0, h1, h2, h3, h4, h5, h6, h7] = iv as [
    bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint
  ];
  const W = new Array<bigint>(80).fill(0n);

  for (let offset = 0; offset < buf.length; offset += 128) {
    for (let i = 0; i < 16; i++) {
      W[i] = dv.getBigUint64(offset + i * 8, false);
    }
    for (let i = 16; i < 80; i++) {
      const w15 = W[i - 15]!;
      const w2 = W[i - 2]!;
      const s0 = rotr64(w15, 1n) ^ rotr64(w15, 8n) ^ (w15 >> 7n);
      const s1 = rotr64(w2, 19n) ^ rotr64(w2, 61n) ^ (w2 >> 6n);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) & MASK64;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ ((~e & MASK64) & g);
      const temp1 = (h + S1 + ch + SHA512_K[i]! + W[i]!) & MASK64;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK64;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK64;
    }

    h0 = (h0 + a) & MASK64;
    h1 = (h1 + b) & MASK64;
    h2 = (h2 + c) & MASK64;
    h3 = (h3 + d) & MASK64;
    h4 = (h4 + e) & MASK64;
    h5 = (h5 + f) & MASK64;
    h6 = (h6 + g) & MASK64;
    h7 = (h7 + h) & MASK64;
  }

  const full = new Uint8Array(64);
  const fullDv = new DataView(full.buffer);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    fullDv.setBigUint64(i * 8, words[i]!, false);
  }
  return full.subarray(0, outLenBytes);
}

export function sha384Bytes(data: Uint8Array): Uint8Array {
  return sha512Core(
    data,
    [
      0xcbbb9d5dc1059ed8n, 0x629a292a367cd507n, 0x9159015a3070dd17n, 0x152fecd8f70e5939n,
      0x67332667ffc00b31n, 0x8eb44a8768581511n, 0xdb0c2e0d64f98fa7n, 0x47b5481dbefa4fa4n,
    ],
    48
  );
}

export function sha512Bytes(data: Uint8Array): Uint8Array {
  return sha512Core(
    data,
    [
      0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
      0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
    ],
    64
  );
}

// --- AES-128 / AES-256 CBC (FIPS 197) ---
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
const RCON = new Uint8Array([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);
const GF2 = new Uint8Array(256);
const GF3 = new Uint8Array(256);
const GF9 = new Uint8Array(256);
const GF11 = new Uint8Array(256);
const GF13 = new Uint8Array(256);
const GF14 = new Uint8Array(256);
const AES_S = new Uint8Array(16);
const AES_TMP = new Uint8Array(16);

function gfMul(a: number, b: number): number {
  let p = 0;
  let aa = a & 0xff;
  let bb = b & 0xff;
  for (let i = 0; i < 8; i++) {
    if ((bb & 1) !== 0) p ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi !== 0) aa ^= 0x1b;
    bb >>>= 1;
  }
  return p;
}

(function initAesTables() {
  let p = 1;
  let q = 1;
  do {
    p = p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0);
    p &= 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q ^= q & 0x80 ? 0x09 : 0;
    q &= 0xff;
    const xformed = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4)) ^ 0x63) & 0xff;
    SBOX[p] = xformed;
    INV_SBOX[xformed] = p;
  } while (p !== 1);
  SBOX[0] = 0x63;
  INV_SBOX[0x63] = 0;
  for (let i = 0; i < 256; i++) {
    GF2[i] = gfMul(i, 2);
    GF3[i] = gfMul(i, 3);
    GF9[i] = gfMul(i, 0x09);
    GF11[i] = gfMul(i, 0x0b);
    GF13[i] = gfMul(i, 0x0d);
    GF14[i] = gfMul(i, 0x0e);
  }
})();

function expandKey(key: Uint8Array): { roundKeys: Uint8Array; rounds: number } {
  const nk = key.length >>> 2; // 4 for AES-128, 8 for AES-256
  const nr = nk + 6; // 10 for AES-128, 14 for AES-256
  const totalWords = 4 * (nr + 1);
  const w = new Uint8Array(totalWords * 4);
  w.set(key, 0);

  const temp = new Uint8Array(4);
  for (let i = nk; i < totalWords; i++) {
    temp[0] = w[(i - 1) * 4]!;
    temp[1] = w[(i - 1) * 4 + 1]!;
    temp[2] = w[(i - 1) * 4 + 2]!;
    temp[3] = w[(i - 1) * 4 + 3]!;

    if (i % nk === 0) {
      const t = temp[0]!;
      temp[0] = SBOX[temp[1]!]! ^ RCON[i / nk]!;
      temp[1] = SBOX[temp[2]!]!;
      temp[2] = SBOX[temp[3]!]!;
      temp[3] = SBOX[t]!;
    } else if (nk > 6 && i % nk === 4) {
      temp[0] = SBOX[temp[0]!]!;
      temp[1] = SBOX[temp[1]!]!;
      temp[2] = SBOX[temp[2]!]!;
      temp[3] = SBOX[temp[3]!]!;
    }

    const prevBase = (i - nk) * 4;
    const dstBase = i * 4;
    w[dstBase] = w[prevBase]! ^ temp[0]!;
    w[dstBase + 1] = w[prevBase + 1]! ^ temp[1]!;
    w[dstBase + 2] = w[prevBase + 2]! ^ temp[2]!;
    w[dstBase + 3] = w[prevBase + 3]! ^ temp[3]!;
  }

  return { roundKeys: w, rounds: nr };
}

function aesEncryptBlock(block: Uint8Array, roundKeys: Uint8Array, rounds: number): Uint8Array {
  const s = AES_S;
  for (let i = 0; i < 16; i++) s[i] = block[i]! ^ roundKeys[i]!;

  const tmp = AES_TMP;
  for (let r = 1; r < rounds; r++) {
    // SubBytes + ShiftRows
    tmp[0] = SBOX[s[0]!]!;
    tmp[1] = SBOX[s[5]!]!;
    tmp[2] = SBOX[s[10]!]!;
    tmp[3] = SBOX[s[15]!]!;
    tmp[4] = SBOX[s[4]!]!;
    tmp[5] = SBOX[s[9]!]!;
    tmp[6] = SBOX[s[14]!]!;
    tmp[7] = SBOX[s[3]!]!;
    tmp[8] = SBOX[s[8]!]!;
    tmp[9] = SBOX[s[13]!]!;
    tmp[10] = SBOX[s[2]!]!;
    tmp[11] = SBOX[s[7]!]!;
    tmp[12] = SBOX[s[12]!]!;
    tmp[13] = SBOX[s[1]!]!;
    tmp[14] = SBOX[s[6]!]!;
    tmp[15] = SBOX[s[11]!]!;

    // MixColumns + AddRoundKey
    const rkOffset = r * 16;
    for (let c = 0; c < 4; c++) {
      const idx = c * 4;
      const a0 = tmp[idx]!;
      const a1 = tmp[idx + 1]!;
      const a2 = tmp[idx + 2]!;
      const a3 = tmp[idx + 3]!;
      s[idx] = GF2[a0]! ^ GF3[a1]! ^ a2 ^ a3 ^ roundKeys[rkOffset + idx]!;
      s[idx + 1] = a0 ^ GF2[a1]! ^ GF3[a2]! ^ a3 ^ roundKeys[rkOffset + idx + 1]!;
      s[idx + 2] = a0 ^ a1 ^ GF2[a2]! ^ GF3[a3]! ^ roundKeys[rkOffset + idx + 2]!;
      s[idx + 3] = GF3[a0]! ^ a1 ^ a2 ^ GF2[a3]! ^ roundKeys[rkOffset + idx + 3]!;
    }
  }

  // Final round: SubBytes + ShiftRows + AddRoundKey
  const rkFinal = rounds * 16;
  const out = new Uint8Array(16);
  out[0] = SBOX[s[0]!]! ^ roundKeys[rkFinal + 0]!;
  out[1] = SBOX[s[5]!]! ^ roundKeys[rkFinal + 1]!;
  out[2] = SBOX[s[10]!]! ^ roundKeys[rkFinal + 2]!;
  out[3] = SBOX[s[15]!]! ^ roundKeys[rkFinal + 3]!;
  out[4] = SBOX[s[4]!]! ^ roundKeys[rkFinal + 4]!;
  out[5] = SBOX[s[9]!]! ^ roundKeys[rkFinal + 5]!;
  out[6] = SBOX[s[14]!]! ^ roundKeys[rkFinal + 6]!;
  out[7] = SBOX[s[3]!]! ^ roundKeys[rkFinal + 7]!;
  out[8] = SBOX[s[8]!]! ^ roundKeys[rkFinal + 8]!;
  out[9] = SBOX[s[13]!]! ^ roundKeys[rkFinal + 9]!;
  out[10] = SBOX[s[2]!]! ^ roundKeys[rkFinal + 10]!;
  out[11] = SBOX[s[7]!]! ^ roundKeys[rkFinal + 11]!;
  out[12] = SBOX[s[12]!]! ^ roundKeys[rkFinal + 12]!;
  out[13] = SBOX[s[1]!]! ^ roundKeys[rkFinal + 13]!;
  out[14] = SBOX[s[6]!]! ^ roundKeys[rkFinal + 14]!;
  out[15] = SBOX[s[11]!]! ^ roundKeys[rkFinal + 15]!;
  return out;
}

function aesDecryptBlock(block: Uint8Array, roundKeys: Uint8Array, rounds: number): Uint8Array {
  const s = AES_S;
  const rkFinal = rounds * 16;
  for (let i = 0; i < 16; i++) s[i] = block[i]! ^ roundKeys[rkFinal + i]!;

  const tmp = AES_TMP;
  for (let r = rounds - 1; r >= 1; r--) {
    // InvShiftRows + InvSubBytes
    tmp[0] = INV_SBOX[s[0]!]!;
    tmp[1] = INV_SBOX[s[13]!]!;
    tmp[2] = INV_SBOX[s[10]!]!;
    tmp[3] = INV_SBOX[s[7]!]!;
    tmp[4] = INV_SBOX[s[4]!]!;
    tmp[5] = INV_SBOX[s[1]!]!;
    tmp[6] = INV_SBOX[s[14]!]!;
    tmp[7] = INV_SBOX[s[11]!]!;
    tmp[8] = INV_SBOX[s[8]!]!;
    tmp[9] = INV_SBOX[s[5]!]!;
    tmp[10] = INV_SBOX[s[2]!]!;
    tmp[11] = INV_SBOX[s[15]!]!;
    tmp[12] = INV_SBOX[s[12]!]!;
    tmp[13] = INV_SBOX[s[9]!]!;
    tmp[14] = INV_SBOX[s[6]!]!;
    tmp[15] = INV_SBOX[s[3]!]!;

    // AddRoundKey + InvMixColumns
    const rkOffset = r * 16;
    for (let c = 0; c < 4; c++) {
      const idx = c * 4;
      const a0 = tmp[idx]! ^ roundKeys[rkOffset + idx]!;
      const a1 = tmp[idx + 1]! ^ roundKeys[rkOffset + idx + 1]!;
      const a2 = tmp[idx + 2]! ^ roundKeys[rkOffset + idx + 2]!;
      const a3 = tmp[idx + 3]! ^ roundKeys[rkOffset + idx + 3]!;
      s[idx] = GF14[a0]! ^ GF11[a1]! ^ GF13[a2]! ^ GF9[a3]!;
      s[idx + 1] = GF9[a0]! ^ GF14[a1]! ^ GF11[a2]! ^ GF13[a3]!;
      s[idx + 2] = GF13[a0]! ^ GF9[a1]! ^ GF14[a2]! ^ GF11[a3]!;
      s[idx + 3] = GF11[a0]! ^ GF13[a1]! ^ GF9[a2]! ^ GF14[a3]!;
    }
  }

  // InvShiftRows + InvSubBytes + AddRoundKey(0)
  const out = new Uint8Array(16);
  out[0] = INV_SBOX[s[0]!]! ^ roundKeys[0]!;
  out[1] = INV_SBOX[s[13]!]! ^ roundKeys[1]!;
  out[2] = INV_SBOX[s[10]!]! ^ roundKeys[2]!;
  out[3] = INV_SBOX[s[7]!]! ^ roundKeys[3]!;
  out[4] = INV_SBOX[s[4]!]! ^ roundKeys[4]!;
  out[5] = INV_SBOX[s[1]!]! ^ roundKeys[5]!;
  out[6] = INV_SBOX[s[14]!]! ^ roundKeys[6]!;
  out[7] = INV_SBOX[s[11]!]! ^ roundKeys[7]!;
  out[8] = INV_SBOX[s[8]!]! ^ roundKeys[8]!;
  out[9] = INV_SBOX[s[5]!]! ^ roundKeys[9]!;
  out[10] = INV_SBOX[s[2]!]! ^ roundKeys[10]!;
  out[11] = INV_SBOX[s[15]!]! ^ roundKeys[11]!;
  out[12] = INV_SBOX[s[12]!]! ^ roundKeys[12]!;
  out[13] = INV_SBOX[s[9]!]! ^ roundKeys[13]!;
  out[14] = INV_SBOX[s[6]!]! ^ roundKeys[14]!;
  out[15] = INV_SBOX[s[3]!]! ^ roundKeys[15]!;
  return out;
}

export function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  autoPad = true
): Uint8Array {
  const { roundKeys, rounds } = expandKey(key);
  let input = plaintext;
  if (autoPad) {
    const padVal = 16 - (plaintext.length % 16);
    input = new Uint8Array(plaintext.length + padVal);
    input.set(plaintext, 0);
    input.fill(padVal, plaintext.length);
  }
  const out = new Uint8Array(input.length);
  let prev = iv;
  const xored = new Uint8Array(16);
  for (let offset = 0; offset < input.length; offset += 16) {
    for (let i = 0; i < 16; i++) {
      xored[i] = input[offset + i]! ^ prev[i]!;
    }
    const enc = aesEncryptBlock(xored, roundKeys, rounds);
    out.set(enc, offset);
    prev = enc;
  }
  return out;
}

export function aesCbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  autoPad = true
): Uint8Array {
  if (iv.length !== 16) {
    throw new RangeError(`Invalid IV length: ${iv.length}`);
  }
  if (ciphertext.length % 16 !== 0 || (autoPad && ciphertext.length === 0)) {
    throw new Error("Invalid ciphertext length for AES-CBC decryption");
  }
  const { roundKeys, rounds } = expandKey(key);
  const out = new Uint8Array(ciphertext.length);
  let prev = iv;
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    const block = ciphertext.subarray(offset, offset + 16);
    const dec = aesDecryptBlock(block, roundKeys, rounds);
    for (let i = 0; i < 16; i++) {
      out[offset + i] = dec[i]! ^ prev[i]!;
    }
    prev = block;
  }
  if (!autoPad) return out;
  const padVal = out[out.length - 1]!;
  if (padVal < 1 || padVal > 16 || padVal > out.length) {
    throw new Error("Invalid PKCS#7 padding");
  }
  for (let i = out.length - padVal; i < out.length; i++) {
    if (out[i] !== padVal) {
      throw new Error("Invalid PKCS#7 padding");
    }
  }
  return out.subarray(0, out.length - padVal);
}
