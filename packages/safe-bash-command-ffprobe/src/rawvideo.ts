import type { MediaBudgetTracker, MediaProbeRecords, MediaProbePacket, MediaProbeFrame } from "@poe-code/mp4-ast";

/** Headerless RGB packets do not require pixel decoding. A short tail is only a packet. */
export function probeRawVideo(bytes: Uint8Array, filename: string, size: string | undefined, pixelFormat: string | undefined, frameRate: string | undefined, budget: MediaBudgetTracker): MediaProbeRecords {
  const dimensions = size?.split("x").map(Number) ?? [];
  const [width = 0, height = 0] = dimensions;
  if (dimensions.length !== 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error("rawvideo input requires a valid -video_size WIDTHxHEIGHT");
  if (pixelFormat !== "rgb24") throw new Error(`Unsupported rawvideo input pixel format '${pixelFormat ?? "yuv420p"}'`);
  const frameBytes = width * height * 3;
  if (!Number.isSafeInteger(frameBytes)) throw new Error("Invalid rawvideo frame size");
  const rate = (frameRate ?? "25").split("/").map(Number);
  const numerator = rate[0]!, denominator = rate[1] ?? 1;
  if (rate.length > 2 || !Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0 || !Number.isFinite(numerator / denominator))
    throw new Error("rawvideo input requires a positive integer or fraction for -framerate");
  const fps = numerator / denominator;
  const packets = Math.ceil(bytes.length / frameBytes), frames = Math.floor(bytes.length / frameBytes);
  budget.checkSamples(packets);
  const durationTicks = Math.round(bytes.length / frameBytes);
  const duration = (durationTicks / fps).toFixed(6);
  function* packetRows(): Generator<MediaProbePacket> {
    for (let index = 0; index < packets; index++) {
      budget.checkCpu();
      const time = (index / fps).toFixed(6);
      yield { codec_type: "video", stream_index: 0, pts: index, pts_time: time, dts: index, dts_time: time,
        duration: 1, duration_time: (1 / fps).toFixed(6), pos: String(index * frameBytes),
        size: String(Math.min(frameBytes, bytes.length - index * frameBytes)), flags: "K_" };
    }
  }
  function* frameRows(): Generator<MediaProbeFrame> {
    for (const packet of packetRows()) {
      if (Number(packet.size) !== frameBytes) continue;
      yield { media_type: "video", stream_index: 0, key_frame: 1, pts: packet.pts, pts_time: packet.pts_time,
        pkt_dts: packet.dts, pkt_dts_time: packet.dts_time, best_effort_timestamp: packet.pts,
        best_effort_timestamp_time: packet.pts_time, duration: 1, duration_time: (1 / fps).toFixed(6),
        pkt_pos: packet.pos, pkt_size: packet.size, width, height, pix_fmt: pixelFormat, pict_type: "I" };
    }
  }
  return {
    streams: [{ index: 0, codec_name: "rawvideo", codec_long_name: "raw video", codec_type: "video",
      codec_tag_string: "RGB[24]", codec_tag: "0x18424752", width, height, pix_fmt: pixelFormat,
      r_frame_rate: `${numerator}/${denominator}`, avg_frame_rate: "0/0", time_base: `${denominator}/${numerator}`,
      start_pts: 0, start_time: "0.000000", duration_ts: durationTicks, duration, bit_rate: String(Math.round(frameBytes * fps * 8)),
      nb_read_packets: String(packets), nb_read_frames: String(frames), disposition: {} }],
    format: { filename, nb_streams: 1, nb_programs: 0, nb_stream_groups: 0, format_name: "rawvideo",
      format_long_name: "raw video", start_time: "0.000000", duration, size: String(bytes.length),
      bit_rate: String(durationTicks ? Math.floor(bytes.length * 8 * fps / durationTicks) : 0), probe_score: 0 },
    chapters: [], packets: packetRows(), frames: frameRows()
  };
}
