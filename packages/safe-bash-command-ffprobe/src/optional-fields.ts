export function parseOptionalFields(value: string): "auto" | "always" | "never" {
  if (value === "auto" || value === "always" || value === "never") return value;
  if (["1", "true", "yes", "on"].includes(value)) return "always";
  if (["0", "false", "no", "off"].includes(value)) return "never";
  if (value === "-1") return "auto";
  throw new Error(`Invalid show_optional_fields value: ${value}`);
}

// Only known optional metadata receives a fallback; arbitrary selected fields
// and nested tags must never be invented or treated as missing metadata.
export function optionalFields<T>(row: Record<string, T>, section: string,
  mode: "auto" | "always" | "never" | undefined, writer: string): Record<string, T | string> {
  const defaults: Record<string, string> = section === "stream" ? {
    profile: "unknown",
    ...(row.codec_type === "audio" ? { channel_layout: "unknown" } : {}),
    id: "N/A", start_pts: "N/A", start_time: "N/A", duration_ts: "N/A", duration: "N/A",
    bit_rate: "N/A", max_bit_rate: "N/A", bits_per_raw_sample: "N/A",
    nb_frames: "N/A", nb_read_frames: "N/A", nb_read_packets: "N/A"
  } : section === "format" ? {
    start_time: "N/A", duration: "N/A", size: "N/A", bit_rate: "N/A"
  } : {};
  const show = mode === "always" || mode !== "never" && writer.split(":")[0]!.split("=")[0]!.toLowerCase() !== "json";
  const result: Record<string, T | string> = { ...row };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (result[key] === undefined || result[key] === fallback) delete result[key];
  }
  for (const [key, fallback] of Object.entries(defaults)) {
    if (result[key] === undefined) {
      if (show) result[key] = fallback;
      else delete result[key];
    }
  }
  return result;
}
