// Adapted from @stacksjs/ts-webp 0.1.7 (MIT) and libwebp. See ../../../LICENSE.webp.
const VP8_NORM = new Uint8Array([
    7, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
]);
const VP8_NEW_RANGE = new Uint8Array([
    127, 127, 191, 127, 159, 191, 223, 127, 143, 159, 175, 191, 207, 223, 239,
    127, 135, 143, 151, 159, 167, 175, 183, 191, 199, 207, 215, 223, 231, 239,
    247, 127, 131, 135, 139, 143, 147, 151, 155, 159, 163, 167, 171, 175, 179,
    183, 187, 191, 195, 199, 203, 207, 211, 215, 219, 223, 227, 231, 235, 239,
    243, 247, 251, 127, 129, 131, 133, 135, 137, 139, 141, 143, 145, 147, 149,
    151, 153, 155, 157, 159, 161, 163, 165, 167, 169, 171, 173, 175, 177, 179,
    181, 183, 185, 187, 189, 191, 193, 195, 197, 199, 201, 203, 205, 207, 209,
    211, 213, 215, 217, 219, 221, 223, 225, 227, 229, 231, 233, 235, 237, 239,
    241, 243, 245, 247, 249, 251, 253, 127,
]);
export class BoolEncoder {
    private buf: Uint8Array;
    private pos = 0;
    private value = 0;
    private range = 254;
    private nbBits = -8;
    private run = 0;
    constructor(initialCapacity = 1024) {
        this.buf = new Uint8Array(initialCapacity);
    }
    private grow(extra: number): void {
        while (this.pos + extra > this.buf.length) {
            const next = new Uint8Array(this.buf.length * 2);
            next.set(this.buf);
            this.buf = next;
        }
    }
    private flush(): void {
        const s = 8 + this.nbBits;
        const bits = Math.floor(this.value / (2 ** s));
        this.value -= bits * (2 ** s);
        this.nbBits -= 8;
        if ((bits & 0xFF) !== 0xFF) {
            this.grow(this.run + 1);
            if (bits & 0x100) {
                if (this.pos > 0)
                    this.buf[this.pos - 1]! = (this.buf[this.pos - 1]! + 1) & 0xFF;
            }
            const fillValue = (bits & 0x100) ? 0x00 : 0xFF;
            while (this.run > 0) {
                this.buf[this.pos++]! = fillValue;
                this.run--;
            }
            this.buf[this.pos++]! = bits & 0xFF;
        }
        else {
            this.run++;
        }
    }
    writeBit(prob: number, bit: number): void {
        const split = (this.range * prob) >>> 8;
        if (bit) {
            this.value += split + 1;
            this.range -= split + 1;
        }
        else {
            this.range = split;
        }
        if (this.range < 127) {
            const shift = VP8_NORM[this.range]!;
            this.range = VP8_NEW_RANGE[this.range]!;
            this.value = this.value * (2 ** shift);
            this.nbBits += shift;
            if (this.nbBits > 0)
                this.flush();
        }
    }
    writeLiteral(value: number, bits: number): void {
        for (let mask = 1 << (bits - 1); mask > 0; mask >>>= 1) {
            this.writeBitUniform(value & mask ? 1 : 0);
        }
    }
    writeBitUniform(bit: number): void {
        const split = this.range >>> 1;
        if (bit) {
            this.value += split + 1;
            this.range -= split + 1;
        }
        else {
            this.range = split;
        }
        if (this.range < 127) {
            this.range = VP8_NEW_RANGE[this.range]!;
            this.value = this.value * 2;
            this.nbBits += 1;
            if (this.nbBits > 0)
                this.flush();
        }
    }
    writeSignedLiteral(value: number, bits: number): void {
        const mag = value < 0 ? -value : value;
        this.writeLiteral(mag, bits);
        this.writeBit(0x80, value < 0 ? 1 : 0);
    }
    finish(): Uint8Array {
        const padBits = 9 - this.nbBits;
        for (let i = 0; i < padBits; i++)
            this.writeBitUniform(0);
        this.nbBits = 0;
        this.flush();
        if (this.run > 0) {
            this.grow(this.run);
            while (this.run > 0) {
                this.buf[this.pos++]! = 0xFF;
                this.run--;
            }
        }
        return this.buf.subarray(0, this.pos);
    }
    byteLength(): number {
        return this.pos;
    }
}
