import type { MediaCodecDescription, MediaDocument } from "@poe-code/mp4-ast";

type ColorMetadata = NonNullable<MediaCodecDescription["colorMetadata"]>;
export type OutputColorOption = [specifier: string, field: keyof ColorMetadata, value: number]
  | [specifier: string, field: "chromaLocation", value: string | undefined];

const chromaLocations = ["unspecified", "left", "center", "topleft", "top", "bottomleft", "bottom"];

const colorOptions: Record<string, { field: keyof ColorMetadata | "chromaLocation"; min: number; values: Record<string, number> }> = {
  "-color_primaries": { field: "primaries", min: 1, values: {
    bt709: 1, unknown: 2, unspecified: 2, bt470m: 4, bt470bg: 5, smpte170m: 6,
    smpte240m: 7, film: 8, bt2020: 9, smpte428: 10, smpte428_1: 10,
    smpte431: 11, smpte432: 12, "jedec-p22": 22, ebu3213: 22
  } },
  "-color_trc": { field: "transfer", min: 1, values: {
    bt709: 1, unknown: 2, unspecified: 2, gamma22: 4, gamma28: 5, smpte170m: 6,
    smpte240m: 7, linear: 8, log100: 9, log: 9, log316: 10, log_sqrt: 10,
    "iec61966-2-4": 11, iec61966_2_4: 11, bt1361e: 12, bt1361: 12,
    "iec61966-2-1": 13, iec61966_2_1: 13, "bt2020-10": 14, bt2020_10bit: 14,
    "bt2020-12": 15, bt2020_12bit: 15, smpte2084: 16, smpte428: 17,
    smpte428_1: 17, "arib-std-b67": 18
  } },
  "-colorspace": { field: "matrix", min: 0, values: {
    rgb: 0, bt709: 1, unknown: 2, unspecified: 2, fcc: 4, bt470bg: 5,
    smpte170m: 6, smpte240m: 7, ycgco: 8, ycocg: 8, bt2020nc: 9,
    bt2020_ncl: 9, bt2020c: 10, bt2020_cl: 10, smpte2085: 11,
    "chroma-derived-nc": 12, "chroma-derived-c": 13, ictcp: 14
  } },
  "-chroma_sample_location": { field: "chromaLocation", min: 0, values: {
    ...Object.fromEntries(chromaLocations.map((name, index) => [name, index])), unknown: 0
  } },
  "-color_range": { field: "range", min: 0, values: {
    unknown: 0, unspecified: 0, tv: 1, mpeg: 1, limited: 1, pc: 2, jpeg: 2, full: 2
  } }
};

export function parseOutputColorOption(option: string, value: string | undefined): OutputColorOption {
  const [name, ...parts] = option.split(":");
  const specifier = parts.join(":");
  if (["v", "a", "s", "d", "t"].includes(parts[0]!)) parts.shift();
  if (parts.length > 1 || (parts[0] && !Array.from(parts[0]).every(char => char >= "0" && char <= "9"))) {
    throw new Error(`Invalid ${name} stream specifier: ${specifier}`);
  }
  const config = colorOptions[name!]!;
  const numeric = value && Object.hasOwn(config.values, value) ? config.values[value]!
    : value?.trim() ? Number(value) : NaN;
  if (config.field === "chromaLocation" && Number.isFinite(numeric) && (numeric < 0 || numeric > 2147483647)) {
    throw new RangeError(`Invalid ${name} value: ${value}`);
  }
  if (!Number.isFinite(numeric) || numeric < config.min || numeric > 2147483647) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }
  return config.field === "chromaLocation"
    ? [specifier, config.field, chromaLocations[numeric % 1 === 0.5 ? 2 * Math.round(numeric / 2) : Math.round(numeric)]]
    : [specifier, config.field, Math.round(numeric)];
}

export function applyOutputColors(doc: MediaDocument, options: readonly OutputColorOption[]): MediaDocument {
  if (!options.length) return doc;
  let videoIndex = 0;
  return { ...doc, tracks: doc.tracks.map((track, trackIndex) => {
    if (track.type !== "video") return track;
    const ordinal = videoIndex++;
    const overrides: ColorMetadata = {};
    const chroma: { chromaLocation?: string | undefined } = {};
    for (const [specifier, field, value] of options) {
      const [selector, index] = specifier.split(":");
      if (selector === "v" ? index && Number(index) !== ordinal : selector && Number(selector) !== trackIndex) continue;
      if (field === "chromaLocation") chroma.chromaLocation = value;
      else overrides[field] = value;
    }
    if (!Object.keys(overrides).length && !Object.hasOwn(chroma, "chromaLocation")) return track;
    return { ...track, codecDescriptions: track.codecDescriptions.map(codec => ({
      ...codec, ...chroma,
      ...(Object.keys(overrides).length ? { colorMetadata: { ...codec.colorMetadata, ...overrides } } : {})
    })) };
  }) };
}
