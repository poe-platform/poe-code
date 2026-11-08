import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";

export function rechunkPcm(tracks: readonly MediaTrack[], filter: string, budget: MediaBudgetTracker): readonly MediaTrack[] {
  let frames = 1024, pad = true;
  for (const option of filter === "pcm_rechunk" ? [] : filter.slice("pcm_rechunk=".length).split(":")) {
    const [key, value, extra] = option.split("=");
    if (!value || extra !== undefined) throw new Error(`Invalid pcm_rechunk option: ${option}`);
    if (key === "n" || key === "nb_out_samples") {
      frames = Number(value);
      if (!Number.isInteger(frames) || frames < 1 || frames > 0x7fffffff) throw new Error("pcm_rechunk: invalid packet sample count");
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
    const outputFrames = pad ? Math.ceil(total / frames) * frames : total;
    budget.checkOutputBytes(outputFrames * stride);
    budget.allocateMemory(outputFrames * stride);
    budget.checkSamples(Math.ceil(total / frames));
    budget.checkDuration(outputFrames / rate);
    const samples: MediaSample[] = [];
    let source = 0, offset = 0;
    for (let start = 0; start < total; start += frames) {
      budget.checkCpu();
      while (track.samples[source] && offset === track.samples[source]!.data.length) { source++; offset = 0; }
      const first = track.samples[source]!;
      const duration = Math.min(frames, outputFrames - start) * track.timescale / rate;
      const dts = first.dts + offset / stride * track.timescale / rate;
      const pts = first.pts + offset / stride * track.timescale / rate;
      const data = new Uint8Array(Math.min(frames, outputFrames - start) * stride);
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
