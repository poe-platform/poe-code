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
export function encodeFlacPackets(doc: MediaDocument, copy = false, compressionLevel?: number, sampleFormat?: string, frameSize?: number, lpcType?: string, channelMode?: string, lpcPasses = 2, budget = new MediaBudgetTracker(), lpcCoeffPrecision?: number, multiDimQuant?: number, minPredictionOrder?: number, maxPredictionOrder?: number, predictionOrderMethod?: string, minPartitionOrder?: number, maxPartitionOrder?: number, exactRiceParameters?: number): Uint8Array[] {
  if (lpcType !== undefined && !["none", "fixed", "levinson", "cholesky"].includes(lpcType)) {
    throw new Error("FLAC lpc_type must be none, fixed, levinson or cholesky");
  }
  if (!Number.isInteger(lpcPasses) || lpcPasses < 1 || lpcPasses > 2147483647) {
    throw new Error("FLAC lpc_passes must be an integer from 1 to 2147483647");
  }
  if (lpcCoeffPrecision !== undefined && (!Number.isInteger(lpcCoeffPrecision) || lpcCoeffPrecision < 0 || lpcCoeffPrecision > 15)) {
    throw new Error("FLAC lpc_coeff_precision must be an integer from 0 to 15");
  }
  if (multiDimQuant !== undefined && multiDimQuant !== 0 && multiDimQuant !== 1) {
    throw new Error("FLAC multi_dim_quant must be 0 or 1");
  }
  for (const [name, value] of [["min_prediction_order", minPredictionOrder], ["max_prediction_order", maxPredictionOrder]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < -1 || value > 32)) {
      throw new Error(`FLAC ${name} must be an integer from -1 to 32`);
    }
  }
  const orderMethods = ["estimation", "2level", "4level", "8level", "search", "log"];
  const method = predictionOrderMethod === undefined || predictionOrderMethod === "-1" ? "search"
    : orderMethods.includes(predictionOrderMethod) ? predictionOrderMethod
    : orderMethods.find((_, i) => String(i) === predictionOrderMethod);
  if (method === undefined) throw new Error("Invalid FLAC prediction_order_method");
  const explicitOrder = minPredictionOrder !== undefined || maxPredictionOrder !== undefined || predictionOrderMethod !== undefined;
  if (explicitOrder && lpcType === undefined) lpcType = "levinson";
  const minimum = minPredictionOrder === undefined || minPredictionOrder === -1 ? (lpcType === "fixed" || lpcType === "none" ? 0 : 1) : minPredictionOrder;
  const maximum = maxPredictionOrder === undefined || maxPredictionOrder === -1 ? Math.max(minimum, lpcType === "fixed" ? 4 : explicitOrder ? 8 : 1) : maxPredictionOrder;
  if (minimum > maximum || ((lpcType === "levinson" || lpcType === "cholesky") && maximum === 0) || (lpcType === "fixed" && explicitOrder && maximum > 4)) {
    throw new Error("Invalid FLAC prediction order bounds");
  }
  if (exactRiceParameters !== undefined && exactRiceParameters !== 0 && exactRiceParameters !== 1) {
    throw new Error("FLAC exact_rice_parameters must be 0 or 1");
  }
  const precision = lpcCoeffPrecision || 15;
  const shift = Math.max(0, precision - 3);
  if ((lpcCoeffPrecision !== undefined || multiDimQuant !== undefined || exactRiceParameters !== undefined) && lpcType === undefined) lpcType = "levinson";
  const level = compressionLevel === undefined || compressionLevel === -1 ? 5 : compressionLevel;
  if (level !== undefined && (!Number.isInteger(level) || level < 0 || level > 12)) {
    throw new Error("FLAC compression_level must be between 0 and 12 (or -1 for default)");
  }
  for (const [name, value] of [["min_partition_order", minPartitionOrder], ["max_partition_order", maxPartitionOrder]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < -1 || value > 8)) {
      throw new Error(`FLAC ${name} must be an integer from -1 to 8`);
    }
  }
  const partitionMin = minPartitionOrder === undefined || minPartitionOrder === -1 ? 0 : minPartitionOrder;
  const partitionMax = maxPartitionOrder === undefined || maxPartitionOrder === -1 ? (level === 0 ? 3 : (level ?? 5) <= 2 ? 4 : (level ?? 5) <= 4 ? 6 : 8) : maxPartitionOrder;
  if ((minPartitionOrder ?? -1) > (maxPartitionOrder ?? -1)) throw new Error("Invalid FLAC partition order bounds");
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
      let bestOrder = -1, bestPartitionOrder = 0, bestSize = length * sampleBits;
      let residuals: number[] = [];
      let bestParameters: number[] = [];
      let coefficients: number[] | undefined;
      // Increasing effort searches more fixed predictor orders. Never emit a
      // Rice subframe larger than verbatim, including for noisy 24-bit PCM.
      if (level !== undefined || lpcType !== undefined || minPartitionOrder !== undefined || maxPartitionOrder !== undefined || exactRiceParameters !== undefined) {
        const lpc = lpcType === "levinson" || lpcType === "cholesky";
        let fitted = 0;
        if (lpc && length > 1) {
          // First-order normal equations. Cholesky refines the fit using
          // inverse residual weights; the first pass seeds multi-pass analysis
          // with autocorrelation, as in FFmpeg's LPC analysis.
          let predictor = 0;
          const passes = lpcType === "cholesky" ? lpcPasses : 1;
          for (let pass = 0; pass < passes; pass++) {
            budget.checkCpu();
            let energy = 0, correlation = 0;
            for (let i = 1; i < length; i++) {
              const previous = samples[i - 1]!, current = samples[i]!;
              const weight = pass === 0 ? 1
                : 1 / Math.max(Number.EPSILON, Math.floor(512 / 2 ** pass) + Math.abs(predictor * previous - current));
              energy += previous * previous * weight;
              correlation += current * previous * weight;
            }
            if (pass === 0 && (lpcType === "levinson" || passes > 1)) energy += samples[length - 1]! ** 2;
            predictor = energy === 0 ? 0 : correlation / energy;
          }
          fitted = Math.max(-(2 ** (precision - 1)), Math.min(2 ** (precision - 1) - 1, Math.round(predictor * 2 ** shift)));
        }
        const maxOrder = lpc ? Math.min(maximum, length - 1) : lpcType === "none" ? 0
          : Math.min(4, explicitOrder ? maximum : Math.floor(((level ?? 5) + 2) / 3), length - 1);
        const minOrder = lpc ? Math.max(1, minimum) : explicitOrder ? minimum : 0;
        const fits: number[][] = [[], [fitted]];
        const estimates: number[] = [];
        if (lpc && maxOrder > 1) {
          const correlations = Array.from({ length: maxOrder + 1 }, (_, lag) => {
            budget.checkCpu();
            let sum = 0;
            for (let i = lag; i < length; i++) sum += samples[i]! * samples[i - lag]!;
            return sum;
          });
          let predictor: number[] = [], error = correlations[0]!;
          for (let order = 1; order <= maxOrder; order++) {
            let reflection = correlations[order]!;
            for (let j = 1; j < order; j++) reflection -= predictor[j - 1]! * correlations[order - j]!;
            reflection = error > 0 ? Math.max(-0.999999, Math.min(0.999999, reflection / error)) : 0;
            predictor = [...predictor.map((value, j) => value - reflection * predictor[order - j - 2]!), reflection];
            error *= 1 - reflection * reflection;
            if (order > 1) fits[order] = predictor.map(value => Math.max(-(2 ** (precision - 1)), Math.min(2 ** (precision - 1) - 1, Math.round(value * 2 ** shift))));
            estimates[order] = (length - order) * Math.log2(Math.max(1, error / length)) / 2 + order * (sampleBits + precision);
          }
        }
        if (lpcType === "cholesky") {
          for (let order = 2; order <= maxOrder; order++) {
            let predictor = fits[order]!.map(value => value / 2 ** shift);
            for (let pass = 0; pass < lpcPasses; pass++) {
              budget.checkCpu();
              const matrix = Array.from({ length: order }, () => new Float64Array(order));
              const rhs = new Float64Array(order);
              for (let i = order; i < length; i++) {
                if (i % 256 === 0) budget.checkCpu();
                let predicted = 0;
                for (let j = 0; j < order; j++) predicted += predictor[j]! * samples[i - j - 1]!;
                const weight = pass === 0 ? 1 : 1 / Math.max(Number.EPSILON, Math.floor(512 / 2 ** pass) + Math.abs(predicted - samples[i]!));
                for (let j = 0; j < order; j++) {
                  const value = samples[i - j - 1]! * weight;
                  rhs[j]! += value * samples[i]!;
                  for (let k = 0; k <= j; k++) matrix[j]![k]! += value * samples[i - k - 1]!;
                }
              }
              // Cholesky factorization and triangular solves. Singular blocks
              // retain the stable autocorrelation fit.
              let singular = false;
              for (let j = 0; j < order; j++) {
                for (let k = 0; k <= j; k++) {
                  let value = matrix[j]![k]!;
                  for (let n = 0; n < k; n++) value -= matrix[j]![n]! * matrix[k]![n]!;
                  if (j === k && value <= 0) { singular = true; break; }
                  matrix[j]![k] = j === k ? Math.sqrt(value) : value / matrix[k]![k]!;
                }
                if (singular) break;
              }
              if (singular) break;
              for (let j = 0; j < order; j++) {
                for (let k = 0; k < j; k++) rhs[j]! -= matrix[j]![k]! * rhs[k]!;
                rhs[j]! /= matrix[j]![j]!;
              }
              for (let j = order - 1; j >= 0; j--) {
                for (let k = j + 1; k < order; k++) rhs[j]! -= matrix[k]![j]! * rhs[k]!;
                rhs[j]! /= matrix[j]![j]!;
              }
              predictor = Array.from(rhs);
            }
            fits[order] = predictor.map(value => Math.max(-(2 ** (precision - 1)), Math.min(2 ** (precision - 1) - 1, Math.round(value * 2 ** shift))));
          }
        }
        let orders = Array.from({ length: Math.max(0, maxOrder - minOrder + 1) }, (_, i) => minOrder + i);
        if (lpc && orders.length > 1) {
          if (method === "estimation") orders = [orders.reduce((best, order) => estimates[order]! < estimates[best]! ? order : best)];
          else if (method === "log") orders = [Math.floor((minOrder + maxOrder) / 2)];
          else if (method !== "search") {
            const levels = method === "2level" ? 2 : method === "4level" ? 4 : 8;
            orders = [...new Set(Array.from({ length: levels }, (_, i) => minOrder + Math.round(i * (maxOrder - minOrder) / (levels - 1))))];
          }
        }
        let logStep = Math.ceil((maxOrder - minOrder) / 4);
        let differences: number[] = Array.from(samples);
        for (const order of lpc ? orders : Array.from({ length: maxOrder + 1 }, (_, i) => i)) {
          const fit = fits[order] ?? [];
          // Try adjacent quantization points against actual Rice cost.
          const candidates = lpc && multiDimQuant === 1
            ? [fit, ...fit.flatMap((_, index) => [-1, 1].map(delta => fit.map((value, i) => value + (i === index ? delta : 0))))
              .filter(values => values.every(value => value >= -(2 ** (precision - 1)) && value < 2 ** (precision - 1)))]
            : [fit];
          for (const candidate of candidates) {
            budget.checkCpu();
            if (lpc) differences = Array.from(samples.subarray(order), (value, i) => {
              let predicted = 0;
              for (let j = 0; j < order; j++) predicted += candidate[j]! * samples[i + order - j - 1]!;
              return value - Math.floor(predicted / 2 ** shift);
            });
            if (!lpc && order < minOrder) continue;
            const folded = differences.map(value => value < 0 ? -2 * value - 1 : 2 * value);
            // A partition must divide the block and leave residuals after warm-up.
            // Short final blocks can therefore reduce even an explicit minimum.
            let maxPartition = partitionMax;
            while (maxPartition > 0 && (length % 2 ** maxPartition !== 0 || length / 2 ** maxPartition <= order)) maxPartition--;
            const partitions = Array.from({ length: maxPartition - Math.min(partitionMin, maxPartition) + 1 }, (_, i) => {
              const partitionOrder = Math.min(partitionMin, maxPartition) + i;
              return { order: partitionOrder, costs: new Array<number>(2 ** partitionOrder).fill(Infinity), parameters: new Array<number>(2 ** partitionOrder).fill(0) };
            });
            if (exactRiceParameters === 1) {
              // Prefix costs let every partition bound share one scan per Rice parameter.
              const costs = new Float64Array(folded.length + 1);
              for (let parameter = 0; parameter < 15; parameter++) {
                budget.checkCpu();
                for (let i = 0; i < folded.length; i++) costs[i + 1] = costs[i]! + Math.floor(folded[i]! / 2 ** parameter) + 1 + parameter;
                for (const partition of partitions) {
                  const size = length / 2 ** partition.order;
                  for (let i = 0; i < partition.costs.length; i++) {
                    const cost = 4 + costs[(i + 1) * size - order]! - costs[Math.max(0, i * size - order)]!;
                    if (cost < partition.costs[i]!) { partition.costs[i] = cost; partition.parameters[i] = parameter; }
                  }
                }
              }
            } else {
              const sums = new Float64Array(folded.length + 1);
              for (let i = 0; i < folded.length; i++) sums[i + 1] = sums[i]! + folded[i]!;
              for (const partition of partitions) {
                budget.checkCpu();
                const size = length / 2 ** partition.order;
                for (let i = 0; i < partition.costs.length; i++) {
                  const start = Math.max(0, i * size - order);
                  const end = (i + 1) * size - order;
                  const count = end - start;
                  // FFmpeg estimates k from the folded sum, corrected for rounding.
                  const mean = (sums[end]! - sums[start]! - Math.floor(count / 2)) / count;
                  const parameter = Math.min(14, Math.floor(Math.log2(Math.max(1, mean))));
                  partition.parameters[i] = parameter;
                  let cost = 4 + count * (parameter + 1);
                  for (let j = start; j < end; j++) cost += Math.floor(folded[j]! / 2 ** parameter);
                  partition.costs[i] = cost;
                }
              }
            }
            for (const partition of partitions) {
              const size = order * sampleBits + 6 + (lpc ? 9 + order * precision : 0) + partition.costs.reduce((sum, cost) => sum + cost, 0);
              if (size < bestSize) {
                bestSize = size;
                bestOrder = order;
                bestPartitionOrder = partition.order;
                bestParameters = partition.parameters;
                residuals = folded;
                coefficients = lpc ? candidate : undefined;
              }
            }
          }
          differences = differences.slice(1).map((value, i) => value - differences[i]!);
          if (lpc && method === "log" && order === orders.at(-1)) {
            while (logStep >= 1) {
              const center = bestOrder < 0 ? order : bestOrder;
              const neighbors = [center - logStep, center + logStep].filter(value => value >= minOrder && value <= maxOrder && !orders.includes(value));
              logStep = Math.floor(logStep / 2);
              if (neighbors.length) { orders.push(...neighbors); break; }
            }
          }
        }
      }
      write(bestOrder < 0 ? 2 : coefficients !== undefined ? (31 + bestOrder) << 1 : (8 + bestOrder) << 1, 8);
      if (bestOrder < 0) {
        for (const sample of samples) write(sample, sampleBits);
      } else {
        for (let i = 0; i < bestOrder; i++) write(samples[i]!, sampleBits);
        if (coefficients !== undefined) {
          write(precision - 1, 4);
          write(shift, 5);
          for (const coefficient of coefficients) write(coefficient, precision);
        }
        write(0, 2); // Rice method 0.
        write(bestPartitionOrder, 4);
        const partitionSize = length / 2 ** bestPartitionOrder;
        let residual = 0;
        for (const [partition, parameter] of bestParameters.entries()) {
          write(parameter, 4);
          const count = partitionSize - (partition === 0 ? bestOrder : 0);
          for (let i = 0; i < count; i++) {
            const value = residuals[residual++]!;
            position += Math.floor(value / 2 ** parameter); // unary zeroes
            write(1, 1);
            write(value, parameter);
          }
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
