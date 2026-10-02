import { parseXml, type XmlElement } from "@poe-code/xml-ast";
import { concatBytes, decodeUtf8, encodeUtf8 } from "../binary.js";
import { concatMp4, muxMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "../mp4.js";
import { parseMpegTs } from "./mpegts.js";
import { MediaBudgetTracker, type MediaDocument, type ParseMediaOptions, type SerializeMediaOptions } from "../types.js";

export interface StreamingSegment {
  readonly uri: string;
  readonly initialization?: string | undefined;
}
export interface StreamingManifest {
  readonly format: "hls" | "dash";
  readonly durationSeconds: number;
  /** One sequence per representation; sequences are muxed, not concatenated together. */
  readonly sequences: readonly (readonly StreamingSegment[])[];
}

function attribute(node: XmlElement, name: string): string | undefined {
  return node.attributes.find(a => a.localName === name)?.value;
}

function durationSeconds(value: string | undefined): number {
  if (!value) return 0;
  if (!value.startsWith("PT")) throw new Error(`Unsupported DASH duration: ${value}`);
  let start = 2;
  let seconds = 0;
  for (let i = 2; i < value.length; i++) {
    const unit = value[i];
    if (unit === "H" || unit === "M" || unit === "S") {
      const number = Number(value.slice(start, i));
      if (!Number.isFinite(number) || number < 0) throw new Error("Invalid DASH duration");
      seconds += number * (unit === "H" ? 3600 : unit === "M" ? 60 : 1);
      start = i + 1;
    }
  }
  if (start !== value.length || !Number.isFinite(seconds)) throw new Error("Invalid DASH duration");
  return seconds;
}

function templateUri(template: string, id: string, number: number, time: number, bandwidth: string): string {
  const parts = template.split("$");
  let result = parts[0]!;
  for (let i = 1; i < parts.length; i += 2) {
    if (i + 1 >= parts.length) throw new Error("Unterminated DASH template token");
    const token = parts[i]!;
    const [name, padding] = token.split("%");
    let value: string;
    if (name === "") value = "$";
    else if (name === "RepresentationID") value = id;
    else if (name === "Number") value = String(number);
    else if (name === "Time") value = String(time);
    else if (name === "Bandwidth") value = bandwidth;
    else throw new Error(`Unsupported DASH template token: ${name}`);
    if (padding) {
      const width = Number(padding.slice(0, -1));
      if (!padding.endsWith("d") || !Number.isInteger(width) || width < 1 || width > 32) throw new Error("Invalid DASH template padding");
      value = value.padStart(width, "0");
    }
    result += value + parts[i + 1]!;
  }
  return result;
}

function hlsAttributes(text: string): Map<string, string> {
  const result = new Map<string, string>();
  let pos = 0;
  while (pos < text.length) {
    const equals = text.indexOf("=", pos);
    if (equals < 0) break;
    const key = text.slice(pos, equals).trim();
    pos = equals + 1;
    const quoted = text[pos] === '"';
    if (quoted) pos++;
    let end = text.indexOf(quoted ? '"' : ",", pos);
    if (end < 0) end = text.length;
    result.set(key, text.slice(pos, end));
    pos = end + (quoted ? 2 : 1);
  }
  return result;
}

/** Enumerates local resources without manufacturing media from playlist metadata. */
export function parseStreamingManifest(bytes: Uint8Array, format: "hls" | "dash", options: ParseMediaOptions = {}): StreamingManifest {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const text = decodeUtf8(bytes);
  if (format === "hls") {
    const segments: StreamingSegment[] = [];
    let duration = 0;
    let initialization: string | undefined;
    for (const raw of text.split("\n")) {
      budget.checkCpu();
      const line = raw.trim();
      if (line.startsWith("#EXTINF:")) duration += Number(line.slice(8).split(",")[0]);
      else if (line.startsWith("#EXT-X-MAP:")) {
        const attrs = hlsAttributes(line.slice(11));
        if (attrs.has("BYTERANGE")) throw new Error("HLS initialization byte ranges are not supported");
        initialization = attrs.get("URI");
        if (!initialization) throw new Error("HLS EXT-X-MAP requires URI");
      } else if (line.startsWith("#EXT-X-KEY:") && hlsAttributes(line.slice(11)).get("METHOD") !== "NONE") {
        throw new Error("Encrypted HLS segments are not supported");
      } else if (line.startsWith("#EXT-X-BYTERANGE:") || line.startsWith("#EXT-X-STREAM-INF:")) {
        throw new Error("HLS requires a media playlist with complete segment files");
      } else if (line && !line.startsWith("#")) {
        budget.checkConcatInputs(segments.length + 1);
        segments.push({ uri: line, initialization });
      }
    }
    if (!segments.length || !Number.isFinite(duration)) throw new Error("Invalid or empty HLS media playlist");
    budget.checkDuration(duration);
    return { format, durationSeconds: duration, sequences: [segments] };
  }

  const mpd = parseXml(text);
  if (mpd.localName !== "MPD") throw new Error("Expected DASH MPD root");
  const duration = durationSeconds(attribute(mpd, "mediaPresentationDuration"));
  budget.checkDuration(duration);
  const periods = mpd.children.filter(n => n.localName === "Period");
  if (periods.length !== 1) throw new Error("DASH requires a single Period");
  const period = periods[0]!;
  const periodDuration = durationSeconds(attribute(period, "duration")) || duration;
  const sequences: StreamingSegment[][] = [];
  for (const adaptation of period.children.filter(n => n.localName === "AdaptationSet")) {
    // Alternative representations are alternatives of the same stream.
    const representation = adaptation.children.find(n => n.localName === "Representation");
    if (!representation) continue;
    budget.checkStreams(sequences.length + 1);
    const ancestors = [mpd, period, adaptation, representation];
    const base = ancestors.map(n => n.children.find(c => c.localName === "BaseURL")?.text.trim() ?? "").join("");
    const templates = ancestors.flatMap(n => n.children.filter(c => c.localName === "SegmentTemplate"));
    const lists = ancestors.flatMap(n => n.children.filter(c => c.localName === "SegmentList"));
    const sequence: StreamingSegment[] = [];
    if (lists.length) {
      const list = lists[lists.length - 1]!;
      const initialization = list.children.find(n => n.localName === "Initialization");
      if (initialization && attribute(initialization, "range")) throw new Error("DASH initialization byte ranges are not supported");
      const initUri = initialization && attribute(initialization, "sourceURL");
      for (const segment of list.children.filter(n => n.localName === "SegmentURL")) {
        budget.checkConcatInputs(sequence.length + 1);
        if (attribute(segment, "mediaRange")) throw new Error("DASH byte ranges are not supported");
        const uri = attribute(segment, "media");
        if (!uri) throw new Error("DASH SegmentURL requires media");
        sequence.push({ uri: base + uri, initialization: initUri ? base + initUri : undefined });
      }
    } else if (templates.length) {
      const attrs = new Map(templates.flatMap(n => n.attributes.map(a => [a.localName, a.value] as const)));
      const media = attrs.get("media");
      if (!media) throw new Error("DASH SegmentTemplate requires media");
      const timescale = Number(attrs.get("timescale") ?? 1);
      let number = Number(attrs.get("startNumber") ?? 1);
      if (!Number.isSafeInteger(timescale) || timescale <= 0 || !Number.isSafeInteger(number) || number < 0) throw new Error("Invalid DASH segment numbering or timescale");
      const id = attribute(representation, "id") ?? "0";
      const bandwidth = attribute(representation, "bandwidth") ?? "0";
      const init = attrs.get("initialization");
      const initialization = init ? base + templateUri(init, id, number, 0, bandwidth) : undefined;
      const add = (time: number) => {
        budget.checkCpu();
        budget.checkConcatInputs(sequence.length + 1);
        sequence.push({ uri: base + templateUri(media, id, number++, time, bandwidth), initialization });
      };
      const timeline = templates.flatMap(n => n.children.filter(c => c.localName === "SegmentTimeline")).at(-1);
      if (timeline) {
        let time = 0;
        const entries = timeline.children.filter(n => n.localName === "S");
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          time = Number(attribute(entry, "t") ?? time);
          const d = Number(attribute(entry, "d"));
          let repeat = Number(attribute(entry, "r") ?? 0);
          if (!Number.isSafeInteger(time) || time < 0 || !Number.isSafeInteger(d) || d <= 0 || !Number.isSafeInteger(repeat) || repeat < -1) throw new Error("Invalid DASH SegmentTimeline");
          if (repeat === -1) {
            const next = entries[i + 1];
            const end = next ? Number(attribute(next, "t")) : periodDuration * timescale;
            if (!Number.isFinite(end) || end <= time) throw new Error("Unbounded DASH SegmentTimeline");
            repeat = Math.ceil((end - time) / d) - 1;
          }
          if (!Number.isSafeInteger(repeat) || !Number.isSafeInteger(number + repeat + 1)) throw new Error("Invalid DASH repeat count");
          budget.checkConcatInputs(sequence.length + repeat + 1);
          for (let r = 0; r <= repeat; r++, time += d) add(time);
        }
      } else {
        const d = Number(attrs.get("duration"));
        if (!(d > 0) || !Number.isFinite(d) || !(periodDuration > 0)) throw new Error("DASH requires a bounded segment duration or timeline");
        const count = Math.ceil(periodDuration * timescale / d);
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(number + count)) throw new Error("Invalid DASH segment count");
        budget.checkConcatInputs(count);
        for (let i = 0; i < count; i++) add(i * d);
      }
    } else if (base) {
      sequence.push({ uri: base });
    }
    if (!sequence.length) throw new Error("DASH representation has no segments");
    sequences.push(sequence);
  }
  if (!sequences.length) throw new Error("DASH manifest has no representations");
  return { format, durationSeconds: periodDuration, sequences };
}

export function parseStreamingDocument(bytes: Uint8Array, format: "hls" | "dash", options: ParseMediaOptions = {}): MediaDocument {
  const manifest = parseStreamingManifest(bytes, format, options);
  const resolve = options.resolveResource;
  if (!resolve) throw new Error(`${format.toUpperCase()} parsing requires resolveResource for referenced segment files`);
  const docs = manifest.sequences.map(sequence => {
    // Parse an fMP4 sequence together so tfdt timestamps and initialization tables
    // remain authoritative across fragments (including audio encoder priming).
    const segments: MediaDocument[] = [];
    let fragments: Uint8Array[] = [];
    let currentInit: string | undefined;
    const flush = () => {
      if (fragments.length) segments.push(parseMp4(concatBytes(fragments), options));
      fragments = [];
    };
    for (const segment of sequence) {
      options.budget?.checkCpu();
      if (segment.initialization) {
        if (currentInit !== segment.initialization) {
          flush();
          currentInit = segment.initialization;
          fragments.push(resolve(currentInit));
        }
        fragments.push(resolve(segment.uri));
      } else {
        flush();
        currentInit = undefined;
        const data = resolve(segment.uri);
        segments.push(data[0] === 0x47 ? parseMpegTs(data, options) : parseMp4(data, options));
      }
    }
    flush();
    return concatMp4(segments, { ...options, alignTrackDurations: false });
  });
  const document = docs.length === 1 ? docs[0]! : muxMp4(docs, options);
  const duration = manifest.durationSeconds || document.durationSeconds;
  return { ...document, containerFormat: format, durationSeconds: duration, duration: Math.round(duration * document.timescale) };
}

/** Produces the manifest and every referenced initialization/media resource. */
export function serializeDashDocument(doc: MediaDocument, options: SerializeMediaOptions = {}): { manifest: Uint8Array; resources: ReadonlyMap<string, Uint8Array> } {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  const resources = new Map<string, Uint8Array>();
  let totalBytes = 0;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${doc.durationSeconds.toFixed(6)}S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-live:2011">`,
    '<Period id="0" start="PT0S">'
  ];
  for (let index = 0; index < doc.tracks.length; index++) {
    const track = doc.tracks[index]!;
    if (track.type !== "video" && track.type !== "audio") throw new Error("DASH output supports video and audio tracks");
    const bytes = serializeMp4({ ...doc, tracks: [track] }, { ...options, fragmented: true });
    totalBytes += bytes.length;
    budget.checkOutputBytes(totalBytes);
    const boxes = parseMp4Boxes(bytes, 0, 0, budget);
    const moof = boxes.find(b => b.type === "moof");
    if (!moof) throw new Error("DASH output requires fragmented MP4 samples");
    resources.set(`init-stream${index}.m4s`, bytes.slice(0, moof.offset));
    resources.set(`chunk-stream${index}-00001.m4s`, bytes.slice(moof.offset));
    const description = track.codecDescriptions[0];
    let codec = description?.formatFourCC ?? "";
    if (description?.avcC) {
      const avc = description.avcC;
      codec = `avc1.${[avc.profileIdc, avc.profileCompatibility, avc.levelIdc].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    } else if (description?.codecName === "aac") codec = "mp4a.40.2";
    const dimensions = track.type === "video" ? ` width="${track.width}" height="${track.height}"` : ` audioSamplingRate="${description?.sampleRate ?? track.timescale}"`;
    lines.push(
      `<AdaptationSet id="${index}" contentType="${track.type}" segmentAlignment="true">`,
      `<Representation id="${index}" mimeType="${track.type}/mp4" codecs="${codec}" bandwidth="${Math.max(1, Math.ceil(bytes.length * 8 / Math.max(doc.durationSeconds, 0.001)))}"${dimensions}>`,
      `<SegmentTemplate timescale="${track.timescale}" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"><SegmentTimeline><S t="0" d="${track.duration}"/></SegmentTimeline></SegmentTemplate>`,
      '</Representation></AdaptationSet>'
    );
  }
  lines.push('</Period></MPD>', '');
  const manifest = encodeUtf8(lines.join("\n"));
  budget.checkOutputBytes(totalBytes + manifest.length);
  return { manifest, resources };
}
