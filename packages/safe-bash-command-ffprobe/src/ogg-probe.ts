import { probeOggStreamSource, type AudioProbeSource, type AudioStream } from "@poe-code/audio-ast";
import type { PagedStorageContext } from "@poe-code/safe-fs/storage";
import { OggIndex } from "./ogg-index.js";
import { FlacTags } from "./flac-tags.js";
import { audioProbeRows, parseArguments } from "./probe.js";
import type { TaggedAudioRow } from "./tag-format.js";

/** Validate base64 picture lines using only a quartet and scalar field lengths. */
async function validatePictures(text: AsyncIterable<string>): Promise<void> {
  let quartet = "", line = false, ended = false, count = 0, word = 0, stage = 0, mark = 8;
  const decode = () => {
    const decoded = atob(quartet); ended ||= quartet.includes("="); quartet = "";
    for (let i = 0; i < decoded.length; i++) {
      count++; word = (word << 8 | decoded.charCodeAt(i)) >>> 0;
      if (stage === 3 && count > mark) throw new Error("Trailing FLAC picture bytes");
      if (count === mark && stage < 3) { mark += word + (stage === 0 ? 4 : stage === 1 ? 20 : 0); stage++; }
    }
  };
  const finish = () => {
    if (line) {
      if (quartet) decode();
      if (stage !== 3 || count !== mark) throw new Error("Truncated or invalid audio structure");
    }
    quartet = ""; line = false; ended = false; count = 0; word = 0; stage = 0; mark = 8;
  };
  for await (const part of text) for (const char of part) {
    if (char === "\n") { finish(); continue; }
    line = true;
    if (char === " " || char === "\t" || char === "\r" || char === "\f") continue;
    if (ended) throw new Error("Invalid character");
    quartet += char; if (quartet.length >= 4) decode();
  }
  finish();
}

/** Validate first, then replay one stream's tag index at a time during staged output. */
export async function probeStoredOgg(source: AudioProbeSource, context: PagedStorageContext, retain: (close: () => Promise<void>) => void): Promise<{ first: AudioStream; rows: (args: readonly string[]) => AsyncIterable<TaggedAudioRow> }> {
  const index = new OggIndex(source, context); retain(index.close); await index.scan();
  let count = 0, group = 0, groupDuration = 0, duration = 0, adjustment = 0;
  let first: AudioStream | undefined, pictures: FlacTags | undefined, failed = true;
  try {
    const physical = index.streams(true);
    for await (const stream of index.streams()) {
      const page = (await physical.next()).value;
      if (!stream.head || !page) throw new Error("Ogg input contains no audio stream");
      let current: FlacTags | undefined, currentFailed = true;
      try {
        const audio = await probeOggStreamSource({ head: stream.head, comments: stream.comments, granule: stream.granule, size: stream.size }, {
          signal: context.signal, onComment: async span => {
            // Any key normalizing to this ASCII name fits in this bounded prefix,
            // including the UTF-8 BOM and Unicode uppercase expansions.
            const prefix = new TextDecoder().decode(await stream.comments!.read(span.offset, Math.min(128, span.length))), equals = prefix.indexOf("=");
            context.signal.throwIfAborted();
            if (equals > 0 && prefix.slice(0, equals).toUpperCase() === "METADATA_BLOCK_PICTURE") {
              current ??= new FlacTags(stream.comments!, context);
              await current.add({ ...span, block: 0 });
            }
          }
        });
        first ??= audio; count++;
        if (stream.group !== group) { duration += groupDuration; groupDuration = 0; group = stream.group; }
        groupDuration = Math.max(groupDuration, audio.duration);
        if (audio.codec === "opus") adjustment = Math.max(adjustment, Number(page.pageGranule) / audio.sampleRate - audio.duration);
        if (current) { const previous = pictures; pictures = current; current = undefined; await previous?.close(); }
        currentFailed = false;
      } finally {
        if (current) {
          if (currentFailed) { try { await current.close(); } catch { /* Preserve primary failure. */ } }
          else await current.close();
        }
      }
    }
    // Empty logical streams have no codec and cannot participate in the AST's chain durations.
    if (!first || !(await physical.next()).done) throw new Error("Ogg input contains no audio stream");
    for await (const entry of pictures?.entries() ?? []) await validatePictures(entry.text());
    failed = false;
  } finally {
    if (pictures) {
      if (failed) { try { await pictures.close(); } catch { /* Preserve primary failure. */ } }
      else await pictures.close();
    }
  }
  duration += groupDuration + adjustment;
  const firstStream = first!;
  return { first: firstStream, rows: async function* (args) {
    const parsed = parseArguments(args), streamSections = new Map([...parsed.sections].filter(([key]) => key === "stream" || key === "stream_tags"));
    if (streamSections.size) {
      let number = 0;
      const physical = index.streams(true);
      for await (const stream of index.streams()) {
        const page = (await physical.next()).value!;
        if (parsed.selector && number !== 0) { number++; continue; }
        const tags = new FlacTags(stream.comments!, context, { raw: true }); let failed = true;
        try {
          const audio = await probeOggStreamSource({ head: stream.head!, comments: stream.comments, granule: stream.granule, size: stream.size }, {
            signal: context.signal, onComment: span => tags.add({ ...span, block: 0 })
          });
          for (const entry of audioProbeRows({ format: "ogg", tags: {}, duration: audio.duration, bitrate: audio.bitrate,
            streams: [{ ...audio, tags: tags.count ? { "": "" } : {} }],
            nodes: [{ type: "OggS", offset: 0, size: 0, data: new Uint8Array(0), fields: { serial: page.serial, granule: page.pageGranule } }]
          }, source.size, { ...parsed, sections: streamSections })) {
            if ("index" in entry.row) entry.row.index = number;
            yield { ...entry, tags };
          }
          failed = false;
        } finally {
          if (failed) { try { await tags.close(); } catch { /* Preserve primary failure. */ } }
          else await tags.close();
        }
        number++;
      }
    }
    const formatSections = new Map([...parsed.sections].filter(([key]) => key === "format" || key === "format_tags"));
    for (const entry of audioProbeRows({ format: "ogg", streams: [firstStream], tags: {}, nodes: [], duration, bitrate: duration ? source.size * 8 / duration : 0 }, source.size, { ...parsed, sections: formatSections })) {
      if ("nb_streams" in entry.row) entry.row.nb_streams = count;
      yield entry;
    }
  } };
}
