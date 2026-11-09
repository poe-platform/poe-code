/*!
 * PIZ wavelet decoding adapted from OpenEXR.
 * Copyright (c) 2002, Industrial Light & Magic, a division of Lucas
 * Digital Ltd. LLC
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 * *       Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 * *       Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 * *       Neither the name of Industrial Light & Magic nor the names of
 * its contributors may be used to endorse or promote products derived
 * from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */
// OpenEXR PIZ: bitmap range expansion, canonical Huffman codes and Haar wavelets.
// Format reference: OpenEXR ImfPizCompressor, ImfHuf and ImfWav.
function huffman(bytes: Uint8Array, words: number): Uint16Array {
    if (bytes.length < 20) throw new Error("Truncated EXR PIZ Huffman header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const first = view.getUint32(0, true), last = view.getUint32(4, true);
    const tableBytes = view.getUint32(8, true), dataBits = view.getUint32(12, true);
    if (first > last || last > 65536 || 20 + tableBytes + Math.ceil(dataBits / 8) !== bytes.length) throw new Error("Invalid EXR PIZ Huffman header");
    let bit = 20 * 8, end = (20 + tableBytes) * 8;
    const read = (count: number): number => {
        if (bit + count > end) throw new Error("Truncated EXR PIZ Huffman bits");
        let value = 0;
        for (let i = 0; i < count; i++, bit++) value = value * 2 + ((bytes[bit >>> 3]! >>> (7 - (bit & 7))) & 1);
        return value;
    };
    const symbols: number[][] = Array.from({ length: 59 }, () => []);
    for (let symbol = first; symbol <= last;) {
        const length = read(6);
        if (length >= 59) {
            symbol += length === 63 ? read(8) + 6 : length - 57;
            if (symbol > last + 1) throw new Error("Invalid EXR PIZ Huffman zero run");
        } else {
            if (length) symbols[length]!.push(symbol);
            symbol++;
        }
    }
    if (Math.ceil(bit / 8) !== 20 + tableBytes) throw new Error("Invalid EXR PIZ Huffman table size");
    // Codes may be 58 bits long. Keep the usual short-code path in exact numbers;
    // only table construction and codes longer than 52 bits need BigInt.
    const starts = new Array<bigint>(59).fill(0n), shortStarts = new Float64Array(53);
    let code = 0n, maximum = 0;
    for (let length = 58; length > 0; length--) {
        starts[length] = code;
        if (length <= 52) shortStarts[length] = Number(code);
        const next = code + BigInt(symbols[length]!.length);
        if (next > (1n << BigInt(length)) || (length > 1 && (next & 1n))) throw new Error("Invalid EXR PIZ Huffman codes");
        code = next >> 1n;
        if (!maximum && symbols[length]!.length) maximum = length;
    }
    if (code !== 1n) throw new Error("Invalid EXR PIZ Huffman codes");
    bit = end; end += dataBits;
    const result = new Uint16Array(words);
    let written = 0;
    while (bit < end) {
        let value = 0, longValue = 0n, symbol = -1;
        for (let length = 1; length <= maximum; length++) {
            const next = read(1);
            let index: number;
            if (length <= 52) {
                value = value * 2 + next;
                index = value - shortStarts[length]!;
            } else {
                longValue = (length === 53 ? BigInt(value) : longValue) * 2n + BigInt(next);
                const delta = longValue - starts[length]!;
                index = delta >= 0n && delta < BigInt(symbols[length]!.length) ? Number(delta) : -1;
            }
            if (index >= 0 && index < symbols[length]!.length) { symbol = symbols[length]![index]!; break; }
        }
        if (symbol < 0) throw new Error("Invalid EXR PIZ Huffman symbol");
        if (symbol === last) {
            const count = read(8);
            if (!written || written + count > words) throw new Error("Invalid EXR PIZ Huffman repeat");
            result.fill(result[written - 1]!, written, written + count); written += count;
        } else {
            if (written === words) throw new Error("Invalid EXR PIZ Huffman output size");
            result[written++] = symbol;
        }
    }
    if (written !== words) throw new Error("Truncated EXR PIZ Huffman output");
    return result;
}

function wavelet(data: Uint16Array, start: number, width: number, height: number, stride: number, maximum: number): void {
    const pair = (a: number, b: number): void => {
        const low = data[a]!, high = data[b]!;
        if (maximum < 16384) {
            const signedLow = (low << 16) >> 16, signedHigh = (high << 16) >> 16;
            const first = signedLow + (signedHigh & 1) + (signedHigh >> 1);
            data[a] = first; data[b] = first - signedHigh;
        } else {
            const second = (low - (high >> 1)) & 65535;
            data[a] = high + second - 32768; data[b] = second;
        }
    };
    let level = 1;
    while (level * 2 <= Math.min(width, height)) level *= 2;
    for (level /= 2; level >= 1; level /= 2) {
        const step = level * 2, dx = level * stride, dy = level * width * stride;
        let y = 0;
        for (; y + step <= height; y += step) {
            let x = 0;
            for (; x + step <= width; x += step) {
                const p = start + (y * width + x) * stride;
                pair(p, p + dy); pair(p + dx, p + dx + dy);
                pair(p, p + dx); pair(p + dy, p + dx + dy);
            }
            if (width & level) { const p = start + (y * width + x) * stride; pair(p, p + dy); }
        }
        if (height & level) for (let x = 0; x + step <= width; x += step) {
            const p = start + (y * width + x) * stride; pair(p, p + dx);
        }
    }
}

export function unpackExrPiz(bytes: Uint8Array, width: number, height: number, channels: readonly { type: number }[]): Uint8Array {
    if (bytes.length < 8) throw new Error("Truncated EXR PIZ chunk");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const first = view.getUint16(0, true), last = view.getUint16(2, true);
    const bitmapBytes = first <= last ? last - first + 1 : 0;
    if (last >= 8192 || 8 + bitmapBytes > bytes.length) throw new Error("Invalid EXR PIZ bitmap");
    const lut = new Uint16Array(65536);
    let values = 1; // Zero is implicit, even when the bitmap is empty.
    for (let i = 0; i < bitmapBytes; i++) for (let bit = 0; bit < 8; bit++) {
        const value = (first + i) * 8 + bit;
        if (value && (bytes[4 + i]! & (1 << bit))) lut[values++] = value;
    }
    const length = view.getUint32(4 + bitmapBytes, true), offset = 8 + bitmapBytes;
    if (offset + length !== bytes.length) throw new Error("Invalid EXR PIZ Huffman size");
    const rowWords = width * channels.reduce((sum, channel) => sum + (channel.type === 1 ? 1 : 2), 0);
    const data = huffman(bytes.subarray(offset), rowWords * height);
    let start = 0;
    for (const channel of channels) {
        const stride = channel.type === 1 ? 1 : 2;
        for (let part = 0; part < stride; part++) wavelet(data, start + part, width, height, stride, values - 1);
        start += width * height * stride;
    }
    // PIZ stores whole channel planes; the scanline decoder consumes row/channel
    // order. Write words explicitly in EXR's little-endian order.
    const result = new Uint8Array(data.length * 2), output = new DataView(result.buffer);
    let written = 0;
    for (let y = 0; y < height; y++) {
        start = 0;
        for (const channel of channels) {
            const count = width * (channel.type === 1 ? 1 : 2), row = start + y * count;
            for (let x = 0; x < count; x++) {
                const value = data[row + x]!;
                if (value >= values) throw new Error("Invalid EXR PIZ range index");
                output.setUint16(written, lut[value]!, true); written += 2;
            }
            start += count * height;
        }
    }
    return result;
}
