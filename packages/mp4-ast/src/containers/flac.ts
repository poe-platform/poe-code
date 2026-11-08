import { md5 } from "@noble/hashes/legacy.js";
import { frameHeader } from "./flac-probe.js";
import { MediaBudgetTracker, type ParseMediaOptions, type MediaAudioData, type MediaTrack, type MediaDocument } from "../types.js";

function crc(bytes: Uint8Array, width: number, polynomial: number): number {
  let value = 0;
  const mask = (1 << width) - 1;
  for (const byte of bytes) {
    value ^= byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) {
      value = ((value << 1) ^ ((value & (1 << (width - 1))) ? polynomial : 0)) & mask;
    }
  }
  return value;
}

function frameNumber(value: number): number[] {
  if (value < 128) return [value];
  const tail: number[] = [];
  while (value >= (1 << (6 - tail.length))) {
    tail.unshift(0x80 | (value & 63));
    value = Math.floor(value / 64);
  }
  return [(0xff << (7 - tail.length)) & 255 | value, ...tail];
}

/** Encode lossless PCM with bounded fixed/LPC predictor and Rice search and verbatim fallback. */
export function encodeFlacPackets(doc: MediaDocument, copy = false, compressionLevel?: number, sampleFormat?: string, frameSize?: number, lpcType?: string, channelMode?: string): Uint8Array[] {
  if (lpcType !== undefined && !["none", "fixed", "levinson", "cholesky"].includes(lpcType)) {
    throw new Error("FLAC lpc_type must be none, fixed, levinson or cholesky");
  }
  const level = compressionLevel === -1 ? 5 : compressionLevel;
  if (level !== undefined && (!Number.isInteger(level) || level < 0 || level > 12)) {
    throw new Error("FLAC compression_level must be between 0 and 12 (or -1 for default)");
  }
  const track = doc.tracks.find(track => track.type === "audio");
  const audio = track?.decodedAudio;
  if (copy || !audio) {
    const extra = track?.codecDescriptions[0]?.extraData;
    if (extra && track?.codecDescriptions[0]?.codecName === "flac") {
      const header = extra.slice();
      const view = new DataView(header.buffer, header.byteOffset);
      const count = track.samples.reduce((sum, sample) => sum + (frameHeader(sample.data, 0)?.duration ?? 0), 0);
      view.setBigUint64(18, (view.getBigUint64(18) & ~0xfffffffffn) | BigInt(count));
      header.fill(0, 26, 42); // The original recording checksum no longer applies.
      return [header, ...track.samples.map(sample => sample.data)];
    }
    throw new Error("FLAC encoding requires decoded PCM audio");
  }
  if (sampleFormat !== undefined && sampleFormat !== "s16" && sampleFormat !== "s32") {
    throw new Error("FLAC sample_fmt must be s16 or s32");
  }
  const { sampleRate, channels, channelData } = audio;
  const modes = ["auto", "indep", "left_side", "right_side", "mid_side"];
  const mode = channelMode === undefined ? 0 : modes.indexOf(channelMode);
  if (mode < 0) throw new Error("Invalid FLAC ch_mode");
  const assignment = channels === 2 && mode >= 2 ? mode + 6 : channels - 1;
  const count = channelData[0]?.length ?? 0;
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 655350 ||
      !Number.isInteger(channels) || channels < 1 || channels > 8 ||
      channelData.length !== channels || channelData.some(data => data.length !== count) || count === 0) {
    throw new Error("Invalid FLAC PCM dimensions");
  }
  const bits = sampleFormat === "s16" ? 16 : sampleFormat === "s32" ? 24
    : track?.codecDescriptions[0]?.bitsPerSample === 24 ? 24 : 16;
  const width = bits / 8;
  const blockSize = frameSize === undefined || frameSize === 0 ? 2048 : frameSize;
  if (!Number.isInteger(blockSize) || blockSize < 16 || blockSize > 65535) {
    throw new Error("FLAC frame_size must be between 16 and 65535 (or 0 for default)");
  }
  const header = new Uint8Array(42);
  header.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
  const view = new DataView(header.buffer);
  view.setUint16(8, blockSize);
  view.setUint16(10, blockSize);
  view.setBigUint64(18, BigInt(sampleRate) << 44n | BigInt(channels - 1) << 41n | BigInt(bits - 1) << 36n | BigInt(count));
  const checksum = md5.create();
  const pcm = new Uint8Array(blockSize * channels * width);
  const frames: Uint8Array[] = [header];
  const standardRate = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000].indexOf(sampleRate);
  const rateCode = standardRate > 0 ? standardRate : sampleRate <= 65535 ? 13 : sampleRate % 10 === 0 ? 14 : 0;
  const rateValue = rateCode === 14 ? sampleRate / 10 : sampleRate;
  const rateBytes = rateCode >= 13 ? [rateValue >>> 8, rateValue & 255] : [];
  for (let offset = 0, index = 0; offset < count; offset += blockSize, index++) {
    const length = Math.min(blockSize, count - offset);
    const prefix = Uint8Array.from([0xff, 0xf8, 0x70 | rateCode, (assignment << 4) | (bits === 24 ? 12 : 8),
      ...frameNumber(index), (length - 1) >>> 8, (length - 1) & 255, ...rateBytes]);
    const frame = new Uint8Array(prefix.length + 1 + channels * (1 + length * width) + Math.ceil(length / 8) + 2);
    frame.set(prefix);
    frame[prefix.length] = crc(prefix, 8, 0x07);
    let position = (prefix.length + 1) * 8;
    const write = (value: number, width: number): void => {
      for (let bit = width - 1; bit >= 0; bit--, position++) {
        frame[position >>> 3]! |= ((value >>> bit) & 1) << (7 - (position & 7));
      }
    };
    const encodedChannels: Int32Array[] = [];
    for (const [channel, data] of channelData.entries()) {
      const samples = new Int32Array(length);
      for (let i = offset; i < offset + length; i++) {
        const value = data[i]!;
        if (!Number.isFinite(value)) throw new Error("FLAC PCM sample must be finite");
        const scale = 2 ** (bits - 1);
        const integer = Math.max(-scale, Math.min(scale - 1, (sampleFormat === undefined ? Math.round(value * scale) : Math.floor(value * scale))));
        samples[i - offset] = integer;
        const pcmOffset = ((i - offset) * channels + channel) * width;
        for (let byte = width - 1; byte >= 0; byte--) {
          const value = (integer >> (byte * 8)) & 255;
          pcm[pcmOffset + byte] = value; // MD5 uses interleaved little-endian PCM.
        }
      }
      encodedChannels.push(samples);
    }
    if (assignment >= 8) {
      for (let i = 0; i < length; i++) {
        const left = encodedChannels[0]![i]!, right = encodedChannels[1]![i]!;
        encodedChannels[0]![i] = assignment === 9 ? left - right : assignment === 10 ? Math.floor((left + right) / 2) : left;
        encodedChannels[1]![i] = assignment === 9 ? right : left - right;
      }
    }
    for (const [channel, samples] of encodedChannels.entries()) {
      const sampleBits = bits + ((assignment === 9 && channel === 0) || ((assignment === 8 || assignment === 10) && channel === 1) ? 1 : 0);
      let bestOrder = -1, bestParameter = 0, bestSize = length * sampleBits;
      let residuals: number[] = [];
      let coefficient: number | undefined;
      // Increasing effort searches more fixed predictor orders. Never emit a
      // Rice subframe larger than verbatim, including for noisy 24-bit PCM.
      if (level !== undefined || lpcType !== undefined) {
        const lpc = lpcType === "levinson" || lpcType === "cholesky";
        let fitted = 0;
        if (lpc && length > 1) {
          // First-order Levinson uses autocorrelation (Toeplitz normal equation);
          // first-order Cholesky solves the covariance least-squares equation.
          let energy = 0, correlation = 0;
          for (let i = 1; i < length; i++) {
            energy += samples[i - 1]! ** 2;
            correlation += samples[i]! * samples[i - 1]!;
          }
          if (lpcType === "levinson") energy += samples[length - 1]! ** 2;
          fitted = energy === 0 ? 0 : Math.max(-16384, Math.min(16383, Math.round(correlation / energy * 4096)));
        }
        const maxOrder = lpc ? Math.min(1, length - 1) : lpcType === "none" ? 0
          : Math.min(4, Math.floor(((level ?? 5) + 2) / 3), length - 1);
        let differences: number[] = Array.from(samples);
        for (let order = lpc ? maxOrder : 0; order <= maxOrder; order++) {
          if (lpc && order === 1) differences = Array.from(samples.subarray(1), (value, i) => value - Math.floor(fitted * samples[i]! / 4096));
          const folded = differences.map(value => value < 0 ? -2 * value - 1 : 2 * value);
          for (let parameter = 0; parameter < 15; parameter++) {
            let size = order * sampleBits + 10 + (lpc && order === 1 ? 24 : 0);
            for (const value of folded) {
              size += Math.floor(value / 2 ** parameter) + 1 + parameter;
              if (size >= bestSize) break;
            }
            if (size < bestSize) {
              bestSize = size;
              bestOrder = order;
              bestParameter = parameter;
              residuals = folded;
              coefficient = lpc && order === 1 ? fitted : undefined;
            }
          }
          differences = differences.slice(1).map((value, i) => value - differences[i]!);
        }
      }
      write(bestOrder < 0 ? 2 : coefficient !== undefined ? 64 : (8 + bestOrder) << 1, 8);
      if (bestOrder < 0) {
        for (const sample of samples) write(sample, sampleBits);
      } else {
        for (let i = 0; i < bestOrder; i++) write(samples[i]!, sampleBits);
        if (coefficient !== undefined) {
          write(14, 4); // Signed 15-bit coefficient.
          write(12, 5); // Q12 predictor shift.
          write(coefficient, 15);
        }
        write(0, 6); // Rice method 0, one residual partition.
        write(bestParameter, 4);
        for (const value of residuals) {
          position += Math.floor(value / 2 ** bestParameter); // unary zeroes
          write(1, 1);
          write(value, bestParameter);
        }
      }
    }
    checksum.update(pcm.subarray(0, length * channels * width));
    const pos = Math.ceil(position / 8);
    new DataView(frame.buffer).setUint16(pos, crc(frame.subarray(0, pos), 16, 0x8005));
    frames.push(frame.slice(0, pos + 2));
  }
  header.set(checksum.digest(), 26);
  return frames;
}

/** Decode FLAC constant, verbatim, fixed and LPC subframes, including Rice residuals. */
export function decodeFlac(track: MediaTrack, options: ParseMediaOptions): MediaAudioData {
  const description = track.codecDescriptions[0]!;
  const channels = description.channels!, bits = description.bitsPerSample!;
  const count = track.samples.reduce((sum, sample) => sum + frameHeader(sample.data, 0)!.duration, 0);
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkDuration(count / track.timescale);
  budget.allocateMemory(count * channels * 8 + 65536 * channels * 8);
  const channelData = Array.from({ length: channels }, () => new Float64Array(count));
  let offset = 0;
  for (const sample of track.samples) {
    budget.checkCpu();
    const bytes = sample.data, header = frameHeader(bytes, 0)!;
    let position = header.headerSize * 8;
    const read = (width: number): number => {
      if (width < 0 || width > 33 || position + width > (bytes.length - 2) * 8) throw new Error("Invalid FLAC subframe");
      let value = 0;
      for (let i = 0; i < width; i++, position++) value = value * 2 + ((bytes[position >>> 3]! >>> (7 - (position & 7))) & 1);
      return value;
    };
    const signed = (width: number): number => {
      const value = read(width);
      return width && value >= 2 ** (width - 1) ? value - 2 ** width : value;
    };
    const unary = (): number => {
      let value = 0;
      while (read(1) === 0) { if (++value % 4096 === 0) budget.checkCpu(); }
      return value;
    };
    const assignment = bytes[3]! >>> 4;
    if ((assignment < 8 ? assignment + 1 : 2) !== channels) throw new Error("Invalid FLAC channel assignment");
    const decoded: Float64Array[] = [];
    for (let channel = 0; channel < channels; channel++) {
      if (read(1)) throw new Error("Invalid FLAC subframe padding");
      const type = read(6), wasted = read(1) ? unary() + 1 : 0;
      const width = bits + ((assignment === 8 && channel === 1) || (assignment === 9 && channel === 0) || (assignment === 10 && channel === 1) ? 1 : 0) - wasted;
      if (width < 1) throw new Error("Invalid FLAC wasted bits");
      const values = new Float64Array(header.duration);
      if (type === 0) values.fill(signed(width));
      else if (type === 1) {
        for (let i = 0; i < values.length; i++) values[i] = signed(width);
      } else {
        const order = type >= 32 ? (type & 31) + 1 : type - 8;
        if ((type < 32 && (order < 0 || order > 4)) || order > values.length) throw new Error("Invalid FLAC predictor");
        for (let i = 0; i < order; i++) values[i] = signed(width);
        let coefficients: number[], shift = 0;
        if (type >= 32) {
          const precision = read(4) + 1;
          if (precision === 16) throw new Error("Invalid FLAC LPC precision");
          shift = signed(5);
          coefficients = Array.from({ length: order }, () => signed(precision));
        } else coefficients = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]][order]!;
        const method = read(2);
        if (method > 1) throw new Error("Invalid FLAC residual method");
        const partitions = 2 ** read(4), partitionSize = values.length / partitions;
        if (!Number.isInteger(partitionSize) || partitionSize < order) throw new Error("Invalid FLAC residual partition");
        let index = order;
        for (let partition = 0; partition < partitions; partition++) {
          const parameter = read(method ? 5 : 4), escape = parameter === (method ? 31 : 15);
          const rawWidth = escape ? read(5) : 0;
          for (let i = partition === 0 ? order : 0; i < partitionSize; i++, index++) {
            const encoded = escape ? 0 : unary() * 2 ** parameter + read(parameter);
            const residual = escape ? signed(rawWidth) : encoded % 2 ? -(encoded + 1) / 2 : encoded / 2;
            let predicted = 0;
            for (let j = 0; j < order; j++) predicted += coefficients[j]! * values[index - j - 1]!;
            values[index] = residual + Math.floor(predicted / 2 ** shift);
          }
        }
      }
      if (wasted) for (let i = 0; i < values.length; i++) values[i]! *= 2 ** wasted;
      decoded.push(values);
    }
    for (let i = 0; i < header.duration; i++) {
      if (assignment === 8) decoded[1]![i] = decoded[0]![i]! - decoded[1]![i]!;
      if (assignment === 9) decoded[0]![i] = decoded[0]![i]! + decoded[1]![i]!;
      if (assignment === 10) {
        const side = decoded[1]![i]!, mid = decoded[0]![i]! * 2 + Math.abs(side % 2);
        decoded[0]![i] = (mid + side) / 2;
        decoded[1]![i] = (mid - side) / 2;
      }
      for (let channel = 0; channel < channels; channel++) channelData[channel]![offset + i] = decoded[channel]![i]! / 2 ** (bits - 1);
    }
    offset += header.duration;
  }
  return { sampleRate: track.timescale, channels, channelData };
}
