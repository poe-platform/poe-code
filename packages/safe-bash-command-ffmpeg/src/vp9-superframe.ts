import { BitReader, type MediaBudgetTracker, type MediaSample, type MediaTrack } from "@poe-code/mp4-ast";

/** Join invisible VP9 frames to the next displayed frame, as the muxer's automatic BSF does. */
export function mergeVp9Superframes(tracks: readonly MediaTrack[], budget: MediaBudgetTracker): readonly MediaTrack[] {
  return tracks.map(track => {
    if (track.type !== "video" || track.codecDescriptions[0]?.codecName !== "vp9") return track;
    const samples: MediaSample[] = [];
    const pending: Uint8Array[] = [];
    for (const sample of track.samples) {
      budget.checkCpu();
      const data = sample.data;
      if (!data.length) {
        if (pending.length) throw new Error("vp9_superframe: empty packet after invisible frame");
        samples.push(sample);
        continue;
      }
      const marker = data[data.length - 1]!;
      const indexSize = 2 + (1 + (marker & 7)) * (1 + ((marker >> 3) & 3));
      const packed = (marker & 0xe0) === 0xc0 && data.length >= indexSize && data[data.length - indexSize] === marker;
      if (packed) {
        if (pending.length) throw new Error("vp9_superframe: cannot mix superframes with pending invisible frames");
        samples.push(sample);
        continue;
      }
      const bits = new BitReader(data);
      bits.readBits(2); // frame marker
      const profile = bits.readBit() | (bits.readBit() << 1);
      if (profile === 3) bits.readBit(); // reserved bit
      const showExisting = bits.readBit();
      let visible = showExisting !== 0;
      if (!showExisting) {
        bits.readBit(); // frame type
        visible = bits.readBit() !== 0;
      }
      if (visible && !pending.length) {
        samples.push(sample);
        continue;
      }
      // FFmpeg's filter accepts at most seven cached frames, including the displayed frame.
      if (pending.length >= 7) throw new Error("vp9_superframe: too many invisible frames");
      pending.push(data);
      if (!visible) continue;
      const largest = Math.max(...pending.map(frame => frame.length));
      const magnitude = Math.max(1, Math.ceil(Math.log2(largest + 1) / 8));
      const payloadSize = pending.reduce((total, frame) => total + frame.length, 0);
      const size = payloadSize + 2 + magnitude * pending.length;
      budget.checkOutputBytes(size);
      budget.allocateMemory(size);
      const merged = new Uint8Array(size);
      let offset = 0;
      for (const frame of pending) {
        merged.set(frame, offset);
        offset += frame.length;
      }
      const indexMarker = 0xc0 | ((magnitude - 1) << 3) | (pending.length - 1);
      merged[offset++] = indexMarker;
      for (const frame of pending) {
        let length = frame.length;
        for (let byte = 0; byte < magnitude; byte++) {
          merged[offset++] = length & 255;
          length = Math.floor(length / 256);
        }
      }
      merged[offset] = indexMarker;
      // Timing, flags and side data belong to the displayed packet.
      samples.push({ ...sample, data: merged, size });
      pending.length = 0;
    }
    // Unpaired invisible frames at EOF are buffered and discarded by the native filter.
    return { ...track, samples };
  });
}
