/*!
 * WavPack decoding adapted from David Bryant’s BSD-licensed reference decoder.
 *                   Copyright (c) 1998 - 2025 David Bryant
 *                           All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 
 *     * Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright notice,
 *       this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of the copyright holder nor the names of its
 *       contributors may be used to endorse or promote products derived from
 *       this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE REGENTS OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import { decodeFourCC, decodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { MediaBudgetTracker, type MediaAstPlugin, type MediaDocument, type MediaSample, type ParseMediaOptions } from "../types.js";

const sampleRates = [6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000, 192000];

function metadata(block: Uint8Array): Map<number, Uint8Array> {
  const result = new Map<number, Uint8Array>();
  for (let pos = 32; pos < block.length;) {
    if (pos + 2 > block.length) throw new Error("Truncated WavPack metadata");
    const id = block[pos++]!;
    let size = block[pos++]! * 2;
    if (id & 0x80) {
      if (pos + 2 > block.length) throw new Error("Truncated WavPack metadata length");
      size += block[pos++]! * 512 + block[pos++]! * 131072;
    }
    const length = size - ((id & 0x40) ? 1 : 0);
    if (length < 0 || pos + size > block.length) throw new Error("Invalid WavPack metadata size");
    result.set(id & 0x3f, block.subarray(pos, pos + length));
    pos += size;
  }
  return result;
}

function exp2(value: number): number {
  const log = Math.abs(value);
  const mantissa = Math.round(256 * 2 ** ((log & 255) / 256));
  const magnitude = Math.floor(mantissa * 2 ** ((log >>> 8) - 9));
  return value < 0 ? -magnitude : magnitude;
}

// WavPack's lossless entropy and decorrelation algorithms. See the license notice above.
function decodeBlock(block: Uint8Array, budget: MediaBudgetTracker): Float64Array[] {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const count = view.getUint32(20, true), flags = view.getUint32(24, true);
  if (flags & (0x8 | 0x80000000)) throw new Error("Unsupported hybrid or DSD WavPack audio");
  const mono = Boolean(flags & (4 | 0x40000000)), channels = mono ? 1 : 2;
  const parts = metadata(block);
  const terms = parts.get(2), weights = parts.get(3), history = parts.get(4), entropy = parts.get(5), stream = parts.get(10);
  if (!terms || terms.length > 16 || !entropy || entropy.length !== channels * 6 || !stream) throw new Error("Missing or invalid WavPack decoder metadata");
  const passes = Array.from(terms, value => {
    const term = (value & 31) - 5;
    if (term === 0 || term < -3 || term > 18 || (term > 8 && term < 17) || (mono && term < 0)) throw new Error("Invalid WavPack decorrelation term");
    return { term, delta: value >>> 5, weights: [0, 0], history: [new Int32Array(8), new Int32Array(8)] };
  });
  if (weights) {
    if (weights.length % channels || weights.length > passes.length * channels) throw new Error("Invalid WavPack weights");
    for (let i = 0; i < weights.length; i++) {
      let weight = (weights[i]! << 24 >> 24) * 8;
      if (weight > 0) weight += (weight + 64) >> 7;
      passes[Math.floor(i / channels)]!.weights[i % channels] = weight;
    }
  }
  if (history) {
    const hv = new DataView(history.buffer, history.byteOffset, history.byteLength);
    let pos = 0;
    const read = () => {
      if (pos + 2 > history.length) throw new Error("Truncated WavPack history");
      const result = exp2(hv.getInt16(pos, true)); pos += 2; return result;
    };
    for (const pass of passes) {
      if (pos === history.length) break;
      if (pass.term > 8) {
        for (let ch = 0; ch < channels; ch++) for (let j = 0; j < 2; j++) pass.history[ch]![j] = read();
      } else if (pass.term < 0) {
        pass.history[0]![0] = read(); pass.history[1]![0] = read();
      } else {
        for (let j = 0; j < pass.term; j++) for (let ch = 0; ch < channels; ch++) pass.history[ch]![j] = read();
      }
    }
    if (pos !== history.length) throw new Error("Invalid WavPack history size");
  }
  const ev = new DataView(entropy.buffer, entropy.byteOffset, entropy.byteLength);
  const medians = [ [0, 0, 0], [0, 0, 0] ];
  for (let ch = 0; ch < channels; ch++) for (let j = 0; j < 3; j++) medians[ch]![j] = exp2(ev.getUint16(ch * 6 + j * 2, true));
  let bit = 0;
  const read = (width: number): number => {
    if (width < 0 || width > 32 || bit + width > stream.length * 8) throw new Error("Truncated WavPack bitstream");
    let value = 0;
    for (let i = 0; i < width; i++, bit++) value += ((stream[bit >>> 3]! >>> (bit & 7)) & 1) * 2 ** i;
    return value;
  };
  const unary = (limit: number): number => {
    let value = 0;
    while (read(1)) if (++value > limit) throw new Error("Invalid WavPack unary code");
    return value;
  };
  const gamma = (): number => { const width = unary(32); return width < 2 ? width : 2 ** (width - 1) + read(width - 1); };
  let holdingOne = 0, holdingZero = 0, zeros = 0;
  const word = (ch: number): number => {
    if (medians[0]![0]! < 2 && medians[1]![0]! < 2 && !holdingOne && !holdingZero) {
      if (zeros) { if (--zeros) return 0; }
      else if ((zeros = gamma())) { medians[0]!.fill(0); medians[1]!.fill(0); return 0; }
    }
    let ones = 0;
    if (holdingZero) holdingZero = 0;
    else {
      ones = unary(16);
      if (ones === 16) ones += gamma();
      const previous = holdingOne;
      holdingOne = ones & 1;
      ones = Math.floor(ones / 2) + previous;
      holdingZero = 1 - holdingOne;
    }
    const median = medians[ch]!;
    let low = 0, high = 0;
    for (let j = 0; j < 3; j++) {
      const width = Math.floor(median[j]! / 16) + 1, divisor = 128 >>> j;
      if (ones === j) {
        high = low + width - 1;
        median[j]! -= Math.floor((median[j]! + divisor - 2) / divisor) * 2;
        break;
      }
      low += width * (j === 2 ? ones - 2 : 1);
      high = low + width - 1;
      median[j]! += Math.floor((median[j]! + divisor) / divisor) * 5;
    }
    if (high > 0x7fffffff) throw new Error("Invalid WavPack residual range");
    const max = high - low, width = max ? Math.floor(Math.log2(max)) + 1 : 0;
    const extras = 2 ** width - max - 1;
    let code = width ? read(width - 1) : 0;
    if (width && code >= extras) code = code * 2 - extras + read(1);
    const value = low + code;
    return read(1) ? ~value : value;
  };
  budget.allocateMemory(count * (flags & 0x40000000 ? 2 : channels) * 8);
  const output = Array.from({ length: channels }, () => new Float64Array(count));
  const extended = parts.get(9);
  if (flags & 0x100 && (!extended || extended.length !== 4 || extended[0])) throw new Error("Unsupported WavPack extended integer bitstream");
  const floatInfo = flags & 0x80 ? parts.get(8) : undefined;
  if (flags & 0x80 && (!floatInfo || floatInfo.length !== 4)) throw new Error("Missing or invalid WavPack float metadata");
  const extra = parts.get(12);
  if (floatInfo && extra && (extra.length <= 4 || extra.length % 2)) throw new Error("Invalid WavPack float bitstream");
  let extraBit = 32, floatCrc = 0xffffffff;
  const floatView = new DataView(new ArrayBuffer(4));
  const readExtra = (width: number): number => {
    if (!extra || extraBit + width > extra.length * 8) throw new Error("Truncated WavPack float bitstream");
    let value = 0;
    for (let i = 0; i < width; i++, extraBit++) value += ((extra[extraBit >>> 3]! >>> (extraBit & 7)) & 1) * 2 ** i;
    return value;
  };
  const decodeFloat = (value: number): number => {
    const floatFlags = floatInfo![0]!;
    let exponent = floatInfo![2]!, sign = 0, mantissa = 0;
    if (!value) {
      if (floatFlags & 8 && readExtra(1)) {
        mantissa = readExtra(23);
        exponent = exponent >= 25 ? readExtra(8) : 0;
        sign = readExtra(1);
      } else {
        exponent = 0;
        if ((floatFlags & 24) === 24) sign = readExtra(1);
      }
    } else {
      value <<= floatInfo![1]! & 31;
      if (value < 0) { value = -value; sign = 1; }
      if (value === 0x1000000) {
        if (readExtra(1)) mantissa = readExtra(23);
        exponent = 255;
      } else {
        let shifted = 0;
        if (exponent) while (!(value & 0x800000) && --exponent) { value <<= 1; shifted++; }
        shifted &= 31;
        if (shifted) {
          if (floatFlags & 1 || (floatFlags & 2 && readExtra(1))) value |= 2 ** shifted - 1;
          else if (floatFlags & 4) value |= readExtra(shifted);
        }
        mantissa = value & 0x7fffff;
      }
    }
    floatCrc = (Math.imul(floatCrc, 27) + mantissa * 9 + exponent * 3 + sign) >>> 0;
    floatView.setUint32(0, (sign << 31) | (exponent << 23) | mantissa, true);
    return floatView.getFloat32(0, true);
  };
  const shift = (flags >>> 13) & 31, scale = 2 ** (((flags & 3) + 1) * 8 - 1);
  let crc = 0xffffffff;
  for (let i = 0; i < count; i++) {
    if (i % 256 === 0) budget.checkCpu();
    const values = [word(0), mono ? 0 : word(1)];
    for (let p = passes.length - 1; p >= 0; p--) {
      const pass = passes[p]!;
      const apply = (ch: number, predicted: number): void => {
        const residual = values[ch]!;
        values[ch] = (residual + Math.floor((pass.weights[ch]! * predicted + 512) / 1024)) | 0;
        if (predicted && residual) {
          pass.weights[ch]! += ((predicted ^ residual) < 0 ? -1 : 1) * pass.delta;
          if (pass.term < 0) pass.weights[ch] = Math.max(-1024, Math.min(1024, pass.weights[ch]!));
        }
      };
      if (pass.term > 0) {
        for (let ch = 0; ch < channels; ch++) {
          const h = pass.history[ch]!;
          const predicted = pass.term === 17 ? (2 * h[0]! - h[1]!) | 0 : pass.term === 18 ? (3 * h[0]! - h[1]!) >> 1 : h[i & 7]!;
          apply(ch, predicted);
          if (pass.term > 8) { h[1] = h[0]!; h[0] = values[ch]!; }
          else h[(i + pass.term) & 7] = values[ch]!;
        }
      } else if (pass.term === -1) {
        apply(0, pass.history[0]![0]!); apply(1, values[0]!); pass.history[0]![0] = values[1]!;
      } else if (pass.term === -2) {
        apply(1, pass.history[1]![0]!); apply(0, values[1]!); pass.history[1]![0] = values[0]!;
      } else {
        apply(0, pass.history[0]![0]!); apply(1, pass.history[1]![0]!);
        pass.history[0]![0] = values[1]!; pass.history[1]![0] = values[0]!;
      }
    }
    if (!mono && flags & 0x10) { values[1] = (values[1]! - (values[0]! >> 1)) | 0; values[0] = (values[0]! + values[1]!) | 0; }
    for (let ch = 0; ch < channels; ch++) {
      let value = values[ch]!;
      crc = (Math.imul(crc, 3) + value) >>> 0;
      if (flags & 0x100) {
        const zeros = extended![1]!, ones = extended![2]!, dups = extended![3]!;
        if (zeros > 31 || ones > 31 || dups > 31) throw new Error("Invalid WavPack integer shift");
        if (zeros) value <<= zeros;
        else if (ones) value = ((value + 1) << ones) - 1;
        else if (dups) value = ((value + (value & 1)) << dups) - (value & 1);
      }
      output[ch]![i] = floatInfo ? decodeFloat(value) : (value << shift) / scale;
    }
  }
  if (crc !== view.getUint32(28, true)) throw new Error("WavPack audio checksum mismatch");
  if (floatInfo && extra && floatCrc !== new DataView(extra.buffer, extra.byteOffset, extra.byteLength).getUint32(0, true)) throw new Error("WavPack float checksum mismatch");
  if (flags & 0x40000000) output.push(output[0]!.slice());
  return output;
}

function parseWavpack(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length); budget.checkStreams(1);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tags: Record<string, string> = Object.create(null);
  let audioEnd = bytes.length;
  const footer = bytes.length - 32;
  if (footer >= 0 && decodeUtf8(bytes.subarray(footer, footer + 8)) === "APETAGEX") {
    const size = view.getUint32(footer + 12, true);
    const count = view.getUint32(footer + 16, true);
    if (size < 32 || size > bytes.length) throw new Error("Invalid APE tag size");
    let pos = bytes.length - size;
    audioEnd = pos;
    if (pos >= 32 && decodeUtf8(bytes.subarray(pos - 32, pos - 24)) === "APETAGEX") audioEnd -= 32;
    for (let i = 0; i < count; i++) {
      budget.checkCpu();
      if (pos + 8 > footer) throw new Error("Truncated APE tag item");
      const length = view.getUint32(pos, true), flags = view.getUint32(pos + 4, true);
      pos += 8;
      const keyEnd = bytes.indexOf(0, pos);
      if (keyEnd < pos || keyEnd >= footer || length > footer - keyEnd - 1) throw new Error("Invalid APE tag item");
      const key = decodeUtf8(bytes.subarray(pos, keyEnd)).toLowerCase();
      pos = keyEnd + 1;
      if ((flags & 6) === 0) tags[key] = decodeUtf8(bytes.subarray(pos, pos + length));
      pos += length;
    }
  }
  const samples: MediaSample[] = [];
  let offset = 0, duration = 0, sampleRate = 0, channels = 0, bits = 0, version = 0;
  let group: { offset: number; count: number; channels: number } | undefined;
  for (; offset < audioEnd;) {
    budget.checkCpu();
    if (decodeFourCC(bytes, offset) === "APET" || decodeFourCC(bytes, offset).startsWith("TAG")) break;
    if (offset + 32 > audioEnd || decodeFourCC(bytes, offset) !== "wvpk") throw new Error("Invalid WavPack block header");
    const size = view.getUint32(offset + 4, true) + 8;
    const blockVersion = view.getUint16(offset + 8, true);
    if (size < 32 || offset + size > audioEnd || blockVersion < 0x402 || blockVersion > 0x410) throw new Error("Invalid WavPack block size or version");
    const block = bytes.subarray(offset, offset + size), parts = metadata(block);
    const count = view.getUint32(offset + 20, true), flags = view.getUint32(offset + 24, true);
    if (count) {
      if (flags & 0x800) {
        if (group) throw new Error("Inconsistent WavPack block group start");
        group = { offset, count, channels: 0 };
        budget.checkSamples(samples.length + 1);
      }
      if (!group || group.count !== count) throw new Error("Inconsistent WavPack block group");
      const customRate = parts.get(0x27);
      const rate = sampleRates[(flags >>> 23) & 15] ?? (customRate?.length === 3 ? customRate[0]! + customRate[1]! * 256 + customRate[2]! * 65536 : 0);
      const width = ((flags & 3) + 1) * 8;
      const index = view.getUint32(offset + 16, true);
      if (!rate || index !== duration || (sampleRate && (rate !== sampleRate || width !== bits || blockVersion !== version))) throw new Error("Inconsistent WavPack audio blocks");
      sampleRate = rate; bits = width; version = blockVersion;
      budget.checkDuration((duration + count) / rate);
      const channelInfo = parts.get(0x0d);
      if (channelInfo) {
        if (channelInfo.length < 2 || channelInfo.length > 7) throw new Error("Invalid WavPack channel information");
        const declaredChannels = channelInfo.length < 6 ? channelInfo[0]! : 1 + channelInfo[0]! + ((channelInfo[2]! & 15) << 8);
        if (!declaredChannels || (channels && channels !== declaredChannels)) throw new Error("Inconsistent WavPack channel count");
        channels = declaredChannels;
      }
      group.channels += flags & 4 ? 1 : 2;
      if (channels && group.channels > channels) throw new Error("Inconsistent WavPack channel count");
      if (flags & 0x1000) {
        if (channels && group.channels !== channels) throw new Error("Inconsistent WavPack channel count");
        channels = group.channels;
        duration += count;
        const data = bytes.subarray(group.offset, offset + size);
        samples.push({ data, dts: index, pts: index, cts: 0, duration: count, size: data.length, isKeyframe: true, sampleDescriptionIndex: 1 });
        group = undefined;
      }
    }
    offset += size;
  }
  if (group) throw new Error("Incomplete WavPack block group");
  if (!samples.length) throw new Error("WavPack input has no audio blocks");
  const total = view.getUint32(12, true);
  if (total !== 0xffffffff && total !== duration) throw new Error("Truncated WavPack audio");
  let channelData: Float64Array[] | undefined;
  if (options.decodeAudio !== false) {
    budget.allocateMemory(duration * channels * 8);
    channelData = Array.from({ length: channels }, () => new Float64Array(duration));
    for (const sample of samples) {
      let channel = 0;
      for (let pos = 0; pos < sample.data.length;) {
        const blockOffset = sample.data.byteOffset + pos - bytes.byteOffset;
        const size = view.getUint32(blockOffset + 4, true) + 8;
        if (view.getUint32(blockOffset + 20, true)) {
          const decoded = decodeBlock(sample.data.subarray(pos, pos + size), budget);
          for (const data of decoded) channelData[channel++]!.set(data, sample.pts);
          budget.releaseMemory(sample.duration * decoded.length * 8);
        }
        pos += size;
      }
    }
  }
  return {
    containerFormat: "wv", timescale: sampleRate, duration, durationSeconds: duration / sampleRate, byteLength: bytes.length, metadata: tags,
    tracks: [{ id: 1, type: "audio", handlerType: "soun", timescale: sampleRate, duration, language: "und", enabled: true,
      codecDescriptions: [{ formatFourCC: "wvpk", codecName: "wavpack", sampleRate, channels, bitsPerSample: bits, extraData: Uint8Array.of(version & 255, version >>> 8) }],
      samples, ...(channelData ? { decodedAudio: { sampleRate, channels, channelData } } : {}) }]
  };
}

export function wavpackAst(): MediaAstPlugin {
  return {
    id: "wv", formatName: "wv", formatLongName: "WavPack", extensions: ["wv"], mimeTypes: ["audio/wavpack"],
    canDemux: true, canMux: false, supportedVideoCodecs: [], supportedAudioCodecs: ["wavpack"],
    detect(bytes) { return bytes.length >= 32 && decodeFourCC(bytes, 0) === "wvpk"; },
    parse: parseWavpack,
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseWavpack(bytes, { ...options, decodeAudio: false }), bytes.length, options.filename,
        { ...options, formatName: "wv", formatLongName: "WavPack" });
    },
    serialize() { throw new Error("WavPack encoding is not supported"); }
  };
}
