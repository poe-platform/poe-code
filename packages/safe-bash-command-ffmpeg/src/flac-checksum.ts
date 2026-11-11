import type { MediaAstPlugin, MediaBudgetTracker, MediaDocument, MediaTrack, SerializeMediaOptions } from "@poe-code/mp4-ast";

export function encodeFlacChecksumTrack(
  doc: MediaDocument, source: MediaTrack, encoder: MediaAstPlugin,
  options: SerializeMediaOptions | undefined, budget: MediaBudgetTracker
): { track: MediaTrack; streamInfo: Uint8Array } {
  const bytes = encoder.serialize({ ...doc, tracks: [source] }, { ...options, audioCodec: "flac", budget });
  budget.allocateMemory(bytes.length);
  const encoded = encoder.parse(bytes, { decodeAudio: false, budget }).tracks.find(track => track.type === "audio")!;
  const streamInfo = bytes.slice(8, 42);
  const blockSize = new DataView(streamInfo.buffer).getUint16(0);
  const channels = ((streamInfo[12]! >> 1) & 7) + 1;
  const bits = ((streamInfo[12]! & 1) << 4 | streamInfo[13]! >> 4) + 1;
  // Initial STREAMINFO has no sample count or MD5 and only an upper bound
  // on packet size: verbatim samples, subframe headers, frame header and CRC.
  const maximum = 18 + channels * Math.ceil((7 + bits) / 8) +
    Math.ceil(blockSize * (channels * bits + (channels === 2 ? 1 : 0)) / 8);
  const initial = streamInfo.slice();
  initial.fill(0, 4, 10);
  initial.fill(0, 14);
  initial[13] = initial[13]! & 0xf0;
  initial.set([maximum >>> 16, maximum >>> 8 & 255, maximum & 255], 7);
  let minimumSize = Infinity, maximumSize = 0;
  const start = Math.round((source.samples[0]?.pts || 0) * encoded.timescale / source.timescale);
  const samples = encoded.samples.map(packet => {
    budget.checkCpu();
    minimumSize = Math.min(minimumSize, packet.data.length);
    maximumSize = Math.max(maximumSize, packet.data.length);
    return { ...packet, dts: packet.dts + start, pts: packet.pts + start };
  });
  streamInfo.set([minimumSize >>> 16, minimumSize >>> 8 & 255, minimumSize & 255], 4);
  streamInfo.set([maximumSize >>> 16, maximumSize >>> 8 & 255, maximumSize & 255], 7);
  const last = samples.at(-1);
  const end = last ? last.pts + last.duration : start;
  samples.push({ dts: end, pts: end, cts: 0, duration: 0, data: new Uint8Array(),
    size: 0, isKeyframe: true, sampleDescriptionIndex: 1 });
  return { streamInfo, track: { ...encoded, samples,
    codecDescriptions: [{ ...encoded.codecDescriptions[0]!, extraData: initial }] } };
}
