import { BinaryWriter, BitWriter, makeBox } from "./binary.js";
import { type MediaBudgetTracker, type MediaSample, type MediaTrack } from "./types.js";

export function encodeAlacTrack(track: MediaTrack, budget: MediaBudgetTracker): MediaTrack {
  const audio = track.decodedAudio;
  if (!audio) throw new Error("ALAC encoding requires decoded audio");
  const { channels, sampleRate, channelData } = audio;
  if (channels !== 1 && channels !== 2) throw new Error("ALAC encoding supports mono and stereo audio");
  const bits = (track.codecDescriptions[0]?.bitsPerSample ?? 16) > 16 ? 24 : 16;
  const frames = channelData[0]?.length ?? 0;
  const frameLength = 4096;
  const samples: MediaSample[] = [];
  budget.checkSamples(Math.ceil(frames / frameLength));
  const scale = 2 ** (bits - 1);
  for (let start = 0; start < frames; start += frameLength) {
    budget.checkCpu();
    const count = Math.min(frameLength, frames - start);
    // ALAC's verbatim frame mode is lossless and needs no predictor state.
    budget.allocateMemory((count * channels * bits / 8 + 8) * 10);
    const writer = new BitWriter();
    writer.writeBits(channels - 1, 3); // single-channel or channel-pair element
    writer.writeBits(0, 4); // element instance
    writer.writeBits(0, 12); // unused header bits
    writer.writeBits(count < frameLength ? 1 : 0, 1); // partial frames carry their sample count
    writer.writeBits(0, 2); // no separately stored low bytes
    writer.writeBits(1, 1); // uncompressed frame
    if (count < frameLength) writer.writeBits(count, 32);
    for (let i = start; i < start + count; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const value = Math.max(-scale, Math.min(scale - 1, Math.round(channelData[ch]![i]! * scale)));
        writer.writeBits(value, bits);
      }
    }
    writer.writeBits(7, 3); // end element
    const data = writer.toUint8Array();
    budget.releaseMemory((count * channels * bits / 8 + 8) * 10 - data.length);
    const dts = Math.round(start * track.timescale / sampleRate);
    samples.push({ data, dts, pts: dts, cts: 0,
      duration: Math.round((start + count) * track.timescale / sampleRate) - dts,
      size: data.length, isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  const config = new BinaryWriter(28);
  config.writeU32BE(0); // version and flags
  config.writeU32BE(frameLength);
  config.writeU8(0); // compatible version
  config.writeU8(bits);
  config.writeU8(40); // Rice history multiplier
  config.writeU8(10); // initial history
  config.writeU8(14); // maximum Rice parameter
  config.writeU8(channels);
  config.writeU16BE(0); // unused maximum run
  config.writeU32BE(frameLength * channels * bits / 8 + 4);
  config.writeU32BE(sampleRate * channels * bits);
  config.writeU32BE(sampleRate);
  const entry = new BinaryWriter(64);
  entry.writeZeros(6);
  entry.writeU16BE(1);
  entry.writeZeros(8);
  entry.writeU16BE(channels);
  entry.writeU16BE(bits);
  entry.writeZeros(4);
  entry.writeU32BE((Math.min(65535, sampleRate) * 65536) >>> 0);
  const extraData = makeBox("alac", config.toUint8Array());
  entry.writeBytes(extraData);
  return { ...track, samples, decodedAudio: undefined, codecDescriptions: [{
    codecName: "alac", formatFourCC: "alac", sampleRate, channels, bitsPerSample: bits,
    extraData, rawStsdEntryBytes: makeBox("alac", entry.toUint8Array())
  }] };
}
