import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";

export function rechunkPcm(tracks: readonly MediaTrack[], filter: string, budget: MediaBudgetTracker): readonly MediaTrack[] {
  let frames = 1024, pad = true;
  let frameRateNumerator = 0, frameRateDenominator = 1;
  for (const option of filter === "pcm_rechunk" ? [] : filter.slice("pcm_rechunk=".length).split(":")) {
    const [key, value, extra] = option.split("=");
    if (!value || extra !== undefined) throw new Error(`Invalid pcm_rechunk option: ${option}`);
    if (key === "n" || key === "nb_out_samples") {
      frames = Number(value);
      if (!Number.isInteger(frames) || frames < 1 || frames > 0x7fffffff) throw new Error("pcm_rechunk: invalid packet sample count");
    } else if (key === "r" || key === "frame_rate") {
      const [numerator, denominator = "1", extra] = value.split("/");
      frameRateNumerator = Number(numerator);
      frameRateDenominator = Number(denominator);
      if (extra !== undefined || !numerator?.trim() || !denominator.trim() ||
          !Number.isFinite(frameRateNumerator) || frameRateNumerator < 0 || frameRateNumerator > 0x7fffffff ||
          !Number.isFinite(frameRateDenominator) || frameRateDenominator <= 0 || frameRateDenominator > 0x7fffffff) {
        throw new Error("pcm_rechunk: invalid frame rate");
      }
    } else if ((key === "p" || key === "pad") && ["0", "1", "false", "true"].includes(value)) {
      pad = value === "1" || value === "true";
    } else throw new Error(`Unsupported pcm_rechunk option: ${option}`);
  }
  return tracks.map(track => {
    if (track.type !== "audio") return track;
    const codec = track.codecDescriptions[0];
    const width = (codec?.bitsPerSample ?? 0) / 8;
    const stride = width * (codec?.channels ?? 0);
    const rate = codec?.sampleRate ?? track.timescale;
    if (!codec?.codecName.startsWith("pcm_") || !Number.isInteger(stride) || stride <= 0 ||
        codec.codecName.endsWith("planar")) throw new Error("pcm_rechunk requires interleaved PCM packets");
    let total = 0;
    for (const sample of track.samples) {
      budget.checkCpu();
      if (sample.data.length % stride) throw new Error("pcm_rechunk: incomplete PCM sample frame");
      total += sample.data.length / stride;
    }
    const numerator = frameRateNumerator ? rate * frameRateDenominator : frames;
    const denominator = frameRateNumerator || 1;
    if (numerator < denominator) throw new Error("pcm_rechunk: frame rate exceeds sample rate");
    // Carry the fraction so packet boundaries round cumulative samples, without drift.
    let remainder = denominator / 2;
    let outputFrames = 0;
    const samples: MediaSample[] = [];
    let source = 0, offset = 0;
    for (let start = 0; start < total; start += frames) {
      budget.checkCpu();
      const next = numerator + remainder;
      frames = Math.floor(next / denominator);
      remainder = next % denominator;
      const packetFrames = pad ? frames : Math.min(frames, total - start);
      outputFrames += packetFrames;
      budget.checkOutputBytes(outputFrames * stride);
      budget.checkSamples(samples.length + 1);
      budget.checkDuration(outputFrames / rate);
      budget.allocateMemory(packetFrames * stride);
      while (track.samples[source] && offset === track.samples[source]!.data.length) { source++; offset = 0; }
      const first = track.samples[source]!;
      const duration = packetFrames * track.timescale / rate;
      const dts = first.dts + offset / stride * track.timescale / rate;
      const pts = first.pts + offset / stride * track.timescale / rate;
      const data = new Uint8Array(packetFrames * stride);
      let written = 0;
      const available = Math.min(frames, total - start) * stride;
      while (written < available) {
        budget.checkCpu();
        const packet = track.samples[source]!;
        const size = Math.min(available - written, packet.data.length - offset);
        data.set(packet.data.subarray(offset, offset + size), written);
        written += size;
        offset += size;
        if (offset === packet.data.length) { source++; offset = 0; }
      }
      samples.push({ data, size: data.length, dts, pts, cts: pts - dts, duration,
        isKeyframe: true, sampleDescriptionIndex: first.sampleDescriptionIndex });
    }
    return { ...track, samples, duration: outputFrames * track.timescale / rate };
  });
}
