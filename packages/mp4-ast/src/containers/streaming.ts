import { parseXml, type XmlElement } from "@poe-code/xml-ast";
import { concatBytes, decodeUtf8, encodeUtf8, gcd } from "../binary.js";
import { buildProbeResultFromDoc, concatMp4, muxMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "../mp4.js";
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
  const adaptations = options.adaptationSets
    ? options.adaptationSets.trim().split(" ").filter(Boolean).map(value => {
      const fields = value.split(",");
      const id = fields.shift()?.split("=");
      const streams = fields.shift()?.split("=");
      if (id?.[0] !== "id" || !id[1] || id.length !== 2 ||
          !Array.from(id[1]).every(c => c >= "0" && c <= "9") ||
          !Number.isSafeInteger(Number(id[1])) || streams?.[0] !== "streams" || streams.length !== 2) {
        throw new Error("Invalid DASH adaptation_sets mapping");
      }
      const indices = [streams[1]!, ...fields].flatMap(selector => {
        if (selector === "a" || selector === "v") {
          return doc.tracks.flatMap((track, index) => track.type === (selector === "a" ? "audio" : "video") ? [index] : []);
        }
        if (!selector || !Array.from(selector).every(c => c >= "0" && c <= "9") ||
            !Number.isSafeInteger(Number(selector)) || Number(selector) >= doc.tracks.length) {
          throw new Error("Invalid DASH adaptation_sets stream");
        }
        return [Number(selector)];
      });
      return { id: Number(id[1]), indices };
    })
    : doc.tracks.map((_, index) => ({ id: index, indices: [index] }));
  const assigned = new Set<number>();
  const ids = new Set<number>();
  for (const adaptation of adaptations) {
    if (ids.has(adaptation.id) || adaptation.indices.length === 0) throw new Error("Invalid DASH adaptation_sets mapping");
    ids.add(adaptation.id);
    for (const index of adaptation.indices) {
      if (assigned.has(index) || doc.tracks[index]!.type !== doc.tracks[adaptation.indices[0]!]!.type) {
        throw new Error("Invalid DASH adaptation_sets stream assignment");
      }
      assigned.add(index);
    }
  }
  if (assigned.size !== doc.tracks.length) throw new Error("DASH adaptation_sets must assign every stream");
  const representations: string[][] = [];
  const adaptationAttributes: string[] = [];
  const initName = options.initSegmentName ?? "init-stream$RepresentationID$.m4s";
  const mediaName = options.mediaSegmentName ?? "chunk-stream$RepresentationID$-$Number%05d$.m4s";
  const [initAttribute, mediaAttribute] = [initName, mediaName].map(name =>
    name.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
  const windowSize = options.windowSize ?? 0;
  if (!Number.isInteger(windowSize) || windowSize < 0 || windowSize > 2_147_483_647) throw new Error("Invalid DASH window size");
  const segmentDuration = options.segmentDuration ?? 5;
  if (!Number.isFinite(segmentDuration) || segmentDuration < 0) throw new Error("Invalid DASH segment duration");
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  const resources = new Map<string, Uint8Array>();
  const streams = buildProbeResultFromDoc(doc, 0).streams;
  const hlsStreams: { codec: string; bandwidth: number }[] = [];
  let totalBytes = 0;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${doc.durationSeconds.toFixed(6)}S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-live:2011">`,
    '<Period id="0" start="PT0S">'
  ];
  for (let index = 0; index < doc.tracks.length; index++) {
    const track = doc.tracks[index]!;
    if (track.type !== "video" && track.type !== "audio") throw new Error("DASH output supports video and audio tracks");
    const starts = [0];
    const origin = track.samples[0]?.dts ?? 0;
    for (let i = 1; i < track.samples.length; i++) {
      const sample = track.samples[i]!;
      if ((track.type === "audio" || sample.isKeyframe) &&
          sample.dts - origin >= starts.length * segmentDuration * track.timescale) starts.push(i);
    }
    const firstSegment = windowSize ? Math.max(0, starts.length - windowSize) : 0;
    const timeline: { time: number; duration: number; repeat: number }[] = [];
    let trackBytes = 0;
    let initialization = new Uint8Array();
    const segments: { time: number; duration: number; bytes: Uint8Array }[] = [];
    for (let segment = 0; segment < starts.length; segment++) {
      const samples = track.samples.slice(starts[segment], starts[segment + 1]);
      const bytes = serializeMp4({ ...doc, tracks: [{ ...track, samples }] }, { ...options, budget, fragmented: true });
      const moof = parseMp4Boxes(bytes, 0, 0, budget).find(b => b.type === "moof");
      if (!moof) throw new Error("DASH output requires fragmented MP4 samples");
      if (segment === 0) {
        initialization = bytes.slice(0, moof.offset);
        trackBytes += moof.offset;
        totalBytes += moof.offset;
      }
      let media: Uint8Array = bytes.slice(moof.offset);
      // mfhd is the first moof child; sequence numbers increase per representation.
      new DataView(media.buffer, media.byteOffset, media.byteLength).setUint32(20, segment + 1);
      if (options.singleFile) {
        // Version 1 sidx: one reference to the immediately following moof/mdat.
        const indexBytes = new Uint8Array(52);
        const view = new DataView(indexBytes.buffer);
        view.setUint32(0, indexBytes.length);
        indexBytes.set(encodeUtf8("sidx"), 4);
        view.setUint8(8, 1);
        view.setUint32(12, track.id);
        view.setUint32(16, track.timescale);
        view.setBigUint64(20, BigInt(samples.reduce((earliest, sample) => Math.min(earliest, Math.max(0, sample.pts)), Math.max(0, samples[0]?.pts ?? 0))));
        view.setUint16(38, 1);
        view.setUint32(40, media.length);
        const last = samples.at(-1);
        view.setUint32(44, last ? last.dts + last.duration - samples[0]!.dts : track.duration);
        view.setUint32(48, samples[0]?.isKeyframe ? 0x90000000 : 0);
        media = concatBytes([indexBytes, media]);
      }
      trackBytes += media.length;
      totalBytes += media.length;
      budget.checkOutputBytes(totalBytes);
      const time = samples[0]?.dts ?? 0;
      const last = samples.at(-1);
      const duration = last ? last.dts + last.duration - time : track.duration;
      segments.push({ time, duration, bytes: media });
      if (segment < firstSegment) continue;
      const previous = timeline.at(-1);
      if (previous && previous.duration === duration && previous.time + previous.duration * (previous.repeat + 1) === time) previous.repeat++;
      else timeline.push({ time, duration, repeat: 0 });
    }
    const bandwidth = String(Number(streams[index]?.bit_rate) > 0 ? streams[index]!.bit_rate : Math.max(1, Math.ceil(trackBytes * 8 / Math.max(doc.durationSeconds, 0.001))));
    const initializationUri = templateUri(initName, String(index), 0, 0, bandwidth);
    const mediaUris = segments.map((media, segment) => templateUri(mediaName, String(index), segment + 1, media.time, bandwidth));
    const segmentTimeline = `<SegmentTimeline>${timeline.map(s => `<S t="${s.time}" d="${s.duration}"${s.repeat ? ` r="${s.repeat}"` : ""}/>`).join("")}</SegmentTimeline>`;
    let singleFileList = "";
    if (options.singleFile) {
      const uri = templateUri(options.singleFileName ?? "stream$RepresentationID$.mp4", String(index), 0, 0, bandwidth);
      let offset = initialization.length;
      singleFileList = segments.map((segment, index) => {
        const start = offset;
        offset += segment.bytes.length;
        if (index < firstSegment) return "";
        const indexSize = new DataView(segment.bytes.buffer, segment.bytes.byteOffset, segment.bytes.byteLength).getUint32(0);
        return `<SegmentURL mediaRange="${start}-${offset - 1}" indexRange="${start}-${start + indexSize - 1}"/>`;
      }).join("");
      resources.set(uri, concatBytes([initialization, ...segments.map(s => s.bytes)]));
      singleFileList = `<BaseURL>${uri.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</BaseURL><SegmentList timescale="${track.timescale}"><Initialization range="0-${initialization.length - 1}"/>${segmentTimeline}${singleFileList}</SegmentList>`;
    } else {
      resources.set(initializationUri, initialization);
      for (const [segment, media] of segments.entries()) {
        resources.set(mediaUris[segment]!, media.bytes);
      }
    }
    const description = track.codecDescriptions[0];
    let codec = description?.formatFourCC ?? "";
    if (description?.avcC) {
      const avc = description.avcC;
      codec = `avc1.${[avc.profileIdc, avc.profileCompatibility, avc.levelIdc].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    } else if (description?.codecName === "aac") codec = `mp4a.40.${description.esds?.audioObjectType ?? 2}`;
    hlsStreams.push({ codec, bandwidth: Number(bandwidth) });
    if (options.hlsPlaylist) {
      const uri = options.singleFile
        ? templateUri(options.singleFileName ?? "stream$RepresentationID$.mp4", String(index), 0, 0, bandwidth)
        : initializationUri;
      const playlist = [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        `#EXT-X-TARGETDURATION:${Math.ceil(segments.slice(firstSegment).reduce((max, segment) => Math.max(max, segment.duration / track.timescale), 0))}`,
        `#EXT-X-MEDIA-SEQUENCE:${firstSegment + 1}`,
        `#EXT-X-MAP:URI="${uri}"${options.singleFile ? `,BYTERANGE="${initialization.length}@0"` : ""}`
      ];
      let offset = initialization.length;
      for (const [number, segment] of segments.entries()) {
        if (number >= firstSegment) {
          playlist.push(`#EXTINF:${(segment.duration / track.timescale).toFixed(6)},`);
          if (options.singleFile) playlist.push(`#EXT-X-BYTERANGE:${segment.bytes.length}@${offset}`);
          playlist.push(options.singleFile ? uri : mediaUris[number]!);
        }
        offset += segment.bytes.length;
      }
      playlist.push("#EXT-X-ENDLIST", "");
      const bytes = encodeUtf8(playlist.join("\n"));
      totalBytes += bytes.length;
      budget.checkOutputBytes(totalBytes);
      resources.set(`media_${index}.m3u8`, bytes);
    }
    let videoAttributes = "";
    let sampleAspectRatio = "";
    if (track.type === "video") {
      const ticks = track.samples.reduce((sum, sample) => sum + sample.duration, 0);
      const frames = track.samples.length * track.timescale;
      if (ticks > 0 && frames > 0) {
        const divisor = gcd(frames, ticks);
        videoAttributes += ` frameRate="${frames / divisor}/${ticks / divisor}"`;
      }
      const sarWidth = description?.sarWidth || 1;
      const sarHeight = description?.sarHeight || 1;
      const sarDivisor = gcd(sarWidth, sarHeight);
      sampleAspectRatio = ` sar="${sarWidth / sarDivisor}:${sarHeight / sarDivisor}"`;
      if (track.width && track.height) {
        const width = track.width * sarWidth;
        const height = track.height * sarHeight;
        const divisor = gcd(width, height);
        videoAttributes += ` par="${width / divisor}:${height / divisor}"`;
      }
    }
    const dimensions = track.type === "video" ? ` width="${track.width}" height="${track.height}"${sampleAspectRatio}` : ` audioSamplingRate="${description?.sampleRate ?? track.timescale}"`;
    const language = track.language && track.language !== "und"
      ? ` lang="${track.language.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}"` : "";
    adaptationAttributes[index] = `contentType="${track.type}" segmentAlignment="true"${language}${videoAttributes}`;
    representations[index] = [
      `<Representation id="${index}" mimeType="${track.type}/mp4" codecs="${codec}" bandwidth="${bandwidth}"${dimensions}>`,
      ...(track.type === "audio" && description?.channels ? [
        `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${description.channels}"/>`
      ] : []),
      options.singleFile ? singleFileList : options.useTemplate === false
        ? `<SegmentList timescale="${track.timescale}"><Initialization sourceURL="${initializationUri.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}"/>${segmentTimeline}${mediaUris.slice(firstSegment).map(uri => `<SegmentURL media="${uri.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}"/>`).join("")}</SegmentList>`
        : options.useTimeline === false
          ? `<SegmentTemplate timescale="1000000" duration="${Math.round(segmentDuration * 1_000_000)}" initialization="${initAttribute}" media="${mediaAttribute}" startNumber="1"/>`
          : `<SegmentTemplate timescale="${track.timescale}" initialization="${initAttribute}" media="${mediaAttribute}" startNumber="${firstSegment + 1}">${segmentTimeline}</SegmentTemplate>`,
      '</Representation>'
    ];
  }
  for (const adaptation of adaptations) {
    lines.push(`<AdaptationSet id="${adaptation.id}" ${adaptationAttributes[adaptation.indices[0]!]}>`);
    for (const index of adaptation.indices) lines.push(...representations[index]!);
    lines.push('</AdaptationSet>');
  }
  if (options.hlsPlaylist) {
    const master = ["#EXTM3U", "#EXT-X-VERSION:7"];
    const audio = doc.tracks.flatMap((track, index) => track.type === "audio" ? [index] : []);
    const video = doc.tracks.flatMap((track, index) => track.type === "video" ? [index] : []);
    for (const index of audio) {
      const language = doc.tracks[index]!.language;
      master.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_A1",NAME="audio_${index}",DEFAULT=${index === audio[0] ? "YES" : "NO"},AUTOSELECT=YES${language && language !== "und" ? `,LANGUAGE="${language}"` : ""},URI="media_${index}.m3u8"`);
    }
    for (const index of video.length ? video : audio) {
      const stream = hlsStreams[index]!;
      const audioStreams = video.length ? audio.map(index => hlsStreams[index]!) : [];
      const codecs = [...new Set([stream.codec, ...audioStreams.map(stream => stream.codec)])].join(",");
      const bandwidth = stream.bandwidth + Math.max(0, ...audioStreams.map(stream => stream.bandwidth));
      const track = doc.tracks[index]!;
      master.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="${codecs}"${track.type === "video" ? `,RESOLUTION=${track.width}x${track.height}` : ""}${audioStreams.length ? ',AUDIO="group_A1"' : ""}`, `media_${index}.m3u8`);
    }
    const bytes = encodeUtf8([...master, ""].join("\n"));
    totalBytes += bytes.length;
    resources.set("master.m3u8", bytes);
  }
  lines.push('</Period></MPD>', '');
  const manifest = encodeUtf8(lines.join("\n"));
  budget.checkOutputBytes(totalBytes + manifest.length);
  return { manifest, resources };
}
