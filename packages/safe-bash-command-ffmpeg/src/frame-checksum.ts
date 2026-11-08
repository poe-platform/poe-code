import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { encodeUtf8, type MediaDocument, type MediaAstPlugin, type MediaBudgetTracker } from "@poe-code/mp4-ast";

const crc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export function serializeFrameChecksum(
  doc: MediaDocument,
  format: string,
  algorithm: string,
  audioCodec: string | undefined,
  rawAudio: MediaAstPlugin | undefined,
  budget: MediaBudgetTracker,
  formatVersion = 2
): Uint8Array {
  if (!rawAudio?.canMux) throw new Error("Raw audio AST is not registered");
  const name = algorithm.toLowerCase();
  const hashes = { md5, sha160: sha1, sha224, sha256, sha384, sha512 };
  if (format !== "framecrc" && name !== "crc32" && !Object.hasOwn(hashes, name)) throw new Error(`Unknown hash algorithm '${algorithm}'`);
  const lines = format === "framecrc" ? [] : ["#format: frame checksums", `#version: ${formatVersion}`, `#hash: ${name.toUpperCase()}`];
  for (const [index, track] of doc.tracks.entries()) {
    if (track.type !== "audio") throw new Error("Frame checksum output requires audio streams");
    const copy = audioCodec === "copy";
    const rate = copy ? track.timescale : track.decodedAudio?.sampleRate ?? track.codecDescriptions[0]?.sampleRate ?? track.timescale;
    const channels = track.decodedAudio?.channels ?? track.codecDescriptions[0]?.channels ?? 0;
    const mask = track.decodedAudio?.channelMask;
    const layouts: Record<number, string> = {
      4: "mono", 3: "stereo", 11: "2.1", 7: "3.0", 259: "3.0(back)",
      15: "3.1", 263: "4.0", 51: "quad", 1539: "quad(side)",
      271: "4.1", 55: "5.0", 1543: "5.0(side)", 63: "5.1", 1551: "5.1(side)",
      1799: "6.0", 1807: "6.1", 1591: "7.0", 1599: "7.1", 255: "7.1(wide)"
    };
    const speakers = mask ? ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"]
      .filter((_, bit) => (mask & (2 ** bit)) !== 0) : [];
    const layout = mask && speakers.length === channels
      ? layouts[mask] ?? `${channels} channels (${speakers.join("+")})`
      : ["0 channels", "mono", "stereo", "2.1", "4.0", "5.0", "5.1", "6.1", "7.1"][channels] ?? `${channels} channels`;
    lines.push(`#tb ${index}: 1/${rate}`, `#media_type ${index}: audio`,
      `#codec_id ${index}: ${copy ? track.codecDescriptions[0]?.codecName : audioCodec ?? "pcm_s16le"}`,
      `#sample_rate ${index}: ${rate}`, `#channel_layout_name ${index}: ${layout}`);
  }
  if (format !== "framecrc") lines.push("#stream#, dts,        pts, duration,     size, hash");
  const rows: { dts: number; rate: number; line: string }[] = [];
  for (const [index, track] of doc.tracks.entries()) {
    const copy = audioCodec === "copy";
    const rate = copy ? track.timescale : track.decodedAudio?.sampleRate ?? track.codecDescriptions[0]?.sampleRate ?? track.timescale;
    const payload = rawAudio.serialize({ ...doc, tracks: [track] }, { audioCodec, budget });
    const frames = track.decodedAudio?.channelData[0]?.length ?? Math.round(track.duration * rate / track.timescale);
    const bytesPerFrame = frames ? payload.length / frames : 0;
    let offset = 0;
    const packets = track.samples.length ? track.samples : payload.length ? [{ dts: 0, pts: 0, duration: track.duration, data: payload }] : [];
    for (const packet of packets) {
      budget.checkCpu();
      const duration = Math.round(packet.duration * rate / track.timescale);
      const size = copy ? packet.data.length : Math.min(payload.length - offset, Math.round(duration * bytesPerFrame));
      const bytes = payload.subarray(offset, offset + size);
      offset += size;
      let digest: string;
      if (format === "framecrc") {
        // Unlike the whole-output crc muxer, framecrc starts Adler-32 at zero.
        let a = 0, b = 0;
        for (let i = 0; i < bytes.length; i++) {
          if (i % 4096 === 0) budget.checkCpu();
          a = (a + bytes[i]!) % 65521;
          b = (b + a) % 65521;
        }
        digest = `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`;
      } else if (name === "crc32") {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
          if (i % 4096 === 0) budget.checkCpu();
          crc = (crc >>> 8) ^ crc32Table[(crc ^ bytes[i]!) & 255]!;
        }
        digest = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
      } else {
        const hash = hashes[name as keyof typeof hashes].create();
        for (let i = 0; i < bytes.length; i += 65536) {
          budget.checkCpu();
          hash.update(bytes.subarray(i, i + 65536));
        }
        digest = bytesToHex(hash.digest());
      }
      const dts = Math.round(packet.dts * rate / track.timescale);
      rows.push({ dts, rate,
        line: `${index}, ${String(dts).padStart(10)}, ${String(Math.round(packet.pts * rate / track.timescale)).padStart(10)}, ${String(duration).padStart(8)}, ${String(size).padStart(8)}, ${digest}` });
    }
  }
  // Stable sorting preserves output stream order at equal packet timestamps.
  rows.sort((a, b) => {
    budget.checkCpu();
    return a.dts * b.rate - b.dts * a.rate;
  });
  for (const row of rows) lines.push(row.line);
  return encodeUtf8(`${lines.join("\n")}\n`);
}
