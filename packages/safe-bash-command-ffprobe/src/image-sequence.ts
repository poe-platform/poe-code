import type { MediaAstPlugin, MediaBudgetTracker, MediaProbeResult, MediaProbePacket, MediaProbeFrame } from "@poe-code/mp4-ast";

export function imageSequenceFilename(pattern: string, number: number): string | undefined {
  let filename = "", numbered = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") { filename += pattern[i]; continue; }
    i++;
    if (pattern[i] === "%") { filename += "%"; continue; }
    let width = 0;
    while (i < pattern.length && pattern[i]! >= "0" && pattern[i]! <= "9") {
      width = width * 10 + Number(pattern[i++]);
      if (width > 1024) throw new Error("Image sequence padding is too large");
    }
    if (pattern[i] !== "d") return undefined;
    filename += String(number).padStart(width, "0");
    numbered = true;
  }
  return numbered ? filename : undefined;
}

export function imagePathMetadata(filename: string) {
  return {
    tags: { "lavf.image2dec.source_path": filename, "lavf.image2dec.source_basename": filename.slice(filename.lastIndexOf("/") + 1) },
    side_data_list: [{ side_data_type: "Strings Metadata" }]
  };
}

export async function probeImageSequence(
  pattern: string, plugin: MediaAstPlugin, readInput: (path: string) => Promise<Uint8Array>,
  budget: MediaBudgetTracker, signal: AbortSignal, frameRate: string | undefined,
  showPackets: boolean, showFrames: boolean, exportPathMetadata: boolean
): Promise<MediaProbeResult> {
  const rate = (frameRate ?? "25").split("/").map(Number);
  const numerator = rate[0]!, denominator = rate[1] ?? 1;
  if (rate.length > 2 || !Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0)
    throw new Error("image2 input requires a positive integer or fraction for -framerate");
  const fps = numerator / denominator;
  let first: MediaProbeResult | undefined, count = 0, size = 0;
  const packets: MediaProbePacket[] = [], frames: MediaProbeFrame[] = [];
  for (let number = 0; ; number++) {
    signal.throwIfAborted();
    budget.checkCpu();
    const filename = imageSequenceFilename(pattern, number)!;
    let bytes: Uint8Array;
    try { bytes = await readInput(filename); }
    catch (error) {
      signal.throwIfAborted();
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      if (count === 0 && number < 4) continue;
      break;
    }
    budget.checkSamples(count + 1);
    const probe = plugin.probe(bytes, { filename, budget, showPackets, showFrames });
    first ??= probe;
    const time = (count / fps).toFixed(6), duration = (1 / fps).toFixed(6);
    for (const packet of probe.packets ?? []) packets.push({ ...packet, ...(exportPathMetadata ? imagePathMetadata(filename) : {}), pts: count, pts_time: time, dts: count, dts_time: time, duration: 1, duration_time: duration });
    for (const frame of probe.frames ?? []) frames.push({ ...frame, pts: count, pts_time: time, pkt_dts: count, pkt_dts_time: time,
      best_effort_timestamp: count, best_effort_timestamp_time: time, duration: 1, duration_time: duration, pkt_duration: 1, pkt_duration_time: duration });
    count++;
    size += bytes.length;
  }
  if (!first) throw new Error(`${pattern}: No matching image sequence files found`);
  const duration = (count / fps).toFixed(6);
  return { ...first,
    streams: first.streams.map(stream => ({ ...stream, r_frame_rate: `${numerator}/${denominator}`, avg_frame_rate: `${numerator}/${denominator}`,
      time_base: `${denominator}/${numerator}`, duration_ts: count, duration, nb_frames: String(count), nb_read_packets: String(count), nb_read_frames: String(count) })),
    format: { ...first.format, filename: pattern, duration, size: String(size), bit_rate: String(Math.floor(size * 8 * fps / count)) },
    packets, frames
  };
}
