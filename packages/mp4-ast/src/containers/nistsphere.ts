import { MediaBudgetTracker, type MediaAstPlugin, type ParseMediaOptions } from "../types.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { rawAudioAsts } from "./raw-audio.js";

const raw = rawAudioAsts();

function parseNistSphere(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const decoder = new TextDecoder();
  const offset = Number(decoder.decode(bytes.subarray(8, 16)).trim());
  if (bytes.length < 16 || !Number.isSafeInteger(offset) || offset < 1024 || offset > bytes.length) {
    throw new Error("Invalid NIST SPHERE header length");
  }
  budget.allocateMemory(offset * 2);
  const fields = new Map<string, string>();
  let ended = false;
  for (const line of decoder.decode(bytes.subarray(16, offset)).split("\n")) {
    budget.checkCpu();
    if (line.trim() === "end_head") { ended = true; break; }
    const separator = line.indexOf(" ");
    const name = line.slice(0, separator);
    const field = line.slice(separator + 1).trimStart();
    const valueStart = field.indexOf(" ");
    const type = field.slice(0, valueStart);
    const value = field.slice(valueStart + 1).trimStart();
    if (separator <= 0 || valueStart < 0 || (type !== "-i" && type !== "-r" && !type.startsWith("-s"))) {
      throw new Error("Invalid NIST SPHERE header field");
    }
    if (type.startsWith("-s")) {
      const length = Number(type.slice(2));
      if (!Number.isSafeInteger(length) || length < 0 || length > value.length) {
        throw new Error("Invalid NIST SPHERE string length");
      }
      fields.set(name, value.slice(0, length));
    } else {
      fields.set(name, value.trim());
    }
  }
  if (!ended) throw new Error("Missing NIST SPHERE end_head");
  const sampleRate = Number(fields.get("sample_rate"));
  const channels = Number(fields.get("channel_count"));
  const duration = Number(fields.get("sample_count"));
  const order = fields.get("sample_byte_format");
  if ((fields.get("sample_coding") ?? "pcm") !== "pcm" || Number(fields.get("sample_n_bytes")) !== 2 ||
      (order !== "01" && order !== "10")) {
    throw new Error("Unsupported NIST SPHERE audio encoding (requires PCM16)");
  }
  if (!Number.isSafeInteger(duration) || duration < 0) throw new Error("Invalid NIST SPHERE sample count");
  budget.checkDuration(duration / sampleRate);
  const format = order === "01" ? "s16le" : "s16be";
  const doc = raw.find(plugin => plugin.id === format)!.parse(bytes.subarray(offset),
    { ...options, budget, sampleRate, channels });
  for (const name of ["channel_count", "sample_count", "sample_rate", "sample_n_bytes",
    "sample_sig_bits", "sample_byte_format", "sample_coding"]) fields.delete(name);
  return { ...doc, containerFormat: "nistsphere", byteLength: bytes.length,
    duration, durationSeconds: duration / sampleRate, metadata: { custom: Object.fromEntries(fields) },
    tracks: doc.tracks.map(track => ({ ...track, duration,
      samples: track.samples.map(sample => ({ ...sample, offset: sample.data.byteOffset - bytes.byteOffset }))
    })) };
}

export function nistSphereAst(): MediaAstPlugin {
  return {
    id: "nistsphere", formatName: "nistsphere", formatLongName: "NIST SPeech HEader REsources",
    extensions: ["sph"], mimeTypes: [], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: ["pcm_s16le", "pcm_s16be"],
    detect: bytes => new TextDecoder().decode(bytes.subarray(0, 8)) === "NIST_1A\n",
    parse: parseNistSphere,
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseNistSphere(bytes, { ...options, decodeAudio: false }),
        bytes.length, options.filename,
        { ...options, formatName: "nistsphere", formatLongName: "NIST SPeech HEader REsources" });
    },
    serialize() { throw new Error("NIST SPHERE output is not supported"); }
  };
}
