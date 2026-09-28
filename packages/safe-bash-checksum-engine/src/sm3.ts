// SM3 compression and padding as specified in GB/T 32905-2016.
const rotate = (word: number, bits: number): number => (word << bits) | (word >>> (32 - bits));
const p0 = (word: number): number => word ^ rotate(word, 9) ^ rotate(word, 17);
const p1 = (word: number): number => word ^ rotate(word, 15) ^ rotate(word, 23);

export class SM3 {
  private state = Uint32Array.of(0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e);
  private buffer = new Uint8Array(64);
  private words = new Uint32Array(68);
  private size = 0;
  private length = 0n;

  update(bytes: Uint8Array): void {
    this.length += BigInt(bytes.length);
    for (let offset = 0; offset < bytes.length;) {
      const count = Math.min(64 - this.size, bytes.length - offset);
      this.buffer.set(bytes.subarray(offset, offset + count), this.size);
      this.size += count;
      offset += count;
      if (this.size === 64) { this.compress(); this.size = 0; }
    }
  }

  private compress(): void {
    const w = this.words;
    const view = new DataView(this.buffer.buffer);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 68; i++) w[i] = p1(w[i - 16]! ^ w[i - 9]! ^ rotate(w[i - 3]!, 15)) ^ rotate(w[i - 13]!, 7) ^ w[i - 6]!;
    let [a, b, c, d, e, f, g, h] = Array.from(this.state) as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const a12 = rotate(a, 12);
      const ss1 = rotate((a12 + e + rotate(i < 16 ? 0x79cc4519 : 0x7a879d8a, i % 32)) | 0, 7);
      const ff = i < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c);
      const gg = i < 16 ? e ^ f ^ g : (e & f) | (~e & g);
      const tt1 = (ff + d + (ss1 ^ a12) + (w[i]! ^ w[i + 4]!)) | 0;
      const tt2 = (gg + h + ss1 + w[i]!) | 0;
      d = c; c = rotate(b, 9); b = a; a = tt1;
      h = g; g = rotate(f, 19); f = e; e = p0(tt2);
    }
    for (const [i, word] of [a, b, c, d, e, f, g, h].entries()) this.state[i] = this.state[i]! ^ word;
  }

  digest(): Uint8Array {
    const bits = BigInt.asUintN(64, this.length * 8n);
    this.buffer[this.size++] = 128;
    this.buffer.fill(0, this.size);
    if (this.size > 56) { this.compress(); this.buffer.fill(0); }
    new DataView(this.buffer.buffer).setBigUint64(56, bits);
    this.compress();
    const result = new Uint8Array(32);
    const view = new DataView(result.buffer);
    for (let i = 0; i < 8; i++) view.setUint32(i * 4, this.state[i]!);
    return result;
  }

  destroy(): void {
    this.state.fill(0); this.buffer.fill(0); this.words.fill(0);
    this.size = 0; this.length = 0n;
  }
}
