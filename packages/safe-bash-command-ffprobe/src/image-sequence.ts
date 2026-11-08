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
  showPackets: boolean, showFrames: boolean, exportPathMetadata: boolean, tsFromFile: number, readMtime: (path: string) => Promise<number>
): Promise<MediaProbeResult> {
  const rate = (frameRate ?? "25").split("/").map(Number);
  const numerator = rate[0]!, denominator = rate[1] ?? 1;
  if (rate.length > 2 || !Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0)
    throw new Error("image2 input requires a positive integer or fraction for -framerate");
  const fps = numerator / denominator;
  const numbered = imageSequenceFilename(pattern, 0) !== undefined;
  let startPts = 0;
  const ticksPerSecond = tsFromFile === 2 ? 1_000_000_000 : 1;
  let first: MediaProbeResult | undefined, count = 0, size = 0;
  const packets: MediaProbePacket[] = [], frames: MediaProbeFrame[] = [];
  for (let number = 0; ; number++) {
    signal.throwIfAborted();
    budget.checkCpu();
    const filename = numbered ? imageSequenceFilename(pattern, number)! : pattern;
    let bytes: Uint8Array;
    try { bytes = await readInput(filename); }
    catch (error) {
      signal.throwIfAborted();
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      if (numbered && count === 0 && number < 4) continue;
      break;
    }
    budget.checkSamples(count + 1);
    const probe = plugin.probe(bytes, { filename, budget, showPackets, showFrames });
    first ??= probe;
    const mtime = tsFromFile ? await readMtime(filename) : 0;
    const pts = tsFromFile === 1 ? Math.floor(mtime / 1000) : tsFromFile === 2 ? Math.round(mtime * 1_000_000) : count;
    if (count === 0) startPts = pts;
    const time = (tsFromFile ? pts / ticksPerSecond : count / fps).toFixed(6);
    const durationTicks = tsFromFile === 2 ? Math.round(ticksPerSecond / fps) : 1;
    const duration = (tsFromFile ? durationTicks / ticksPerSecond : 1 / fps).toFixed(6);
    for (const packet of probe.packets ?? []) packets.push({ ...packet, ...(exportPathMetadata ? imagePathMetadata(filename) : {}), pts, pts_time: time, dts: pts, dts_time: time, duration: durationTicks, duration_time: duration });
    for (const frame of probe.frames ?? []) frames.push({ ...frame, pts, pts_time: time, pkt_dts: pts, pkt_dts_time: time,
      best_effort_timestamp: pts, best_effort_timestamp_time: time, duration: durationTicks, duration_time: duration, pkt_duration: durationTicks, pkt_duration_time: duration });
    count++;
    size += bytes.length;
    if (!numbered) break;
  }
  if (!first) throw new Error(`${pattern}: No matching image sequence files found`);
  const duration = (count / fps).toFixed(6);
  return { ...first,
    streams: first.streams.map(stream => ({ ...stream,
      r_frame_rate: tsFromFile === 1 ? "1/1" : `${numerator}/${denominator}`,
      avg_frame_rate: tsFromFile ? "0/0" : `${numerator}/${denominator}`,
      time_base: tsFromFile ? `1/${ticksPerSecond}` : `${denominator}/${numerator}`,
      duration_ts: tsFromFile ? undefined : count, duration: tsFromFile ? undefined : duration,
      nb_frames: tsFromFile ? undefined : String(count), nb_read_packets: String(count), nb_read_frames: String(count),
      ...(tsFromFile ? { start_pts: startPts, start_time: (startPts / ticksPerSecond).toFixed(6) } : {}) })),
    format: { ...first.format, filename: pattern, duration: tsFromFile ? "N/A" : duration,
      size: tsFromFile ? "N/A" : String(size), bit_rate: tsFromFile ? "N/A" : String(Math.floor(size * 8 * fps / count)),
      ...(tsFromFile ? { start_time: (startPts / ticksPerSecond).toFixed(6) } : {}) },
    packets, frames
  };
}
