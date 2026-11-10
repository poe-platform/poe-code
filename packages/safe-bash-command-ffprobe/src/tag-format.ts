import { StringValidation, probeJsonString } from "./string-validation.js";
import { parseWriterBoolean } from "./writer-boolean.js";
import { escapeIni } from "./probe-text.js";
import type { AudioAst } from "@poe-code/audio-ast";
import { audioProbeRows, parseArguments } from "./probe.js";
type Text = string | (() => AsyncIterable<string>);
export interface StoredAudioTags {
  readonly count: number;
  entries(): AsyncIterable<{ key: Text; text: () => AsyncIterable<string> }>;
}

type Value = string | number | (() => AsyncIterable<string>);
async function* parts(value: Value): AsyncGenerator<string> {
  if (typeof value === "function") yield* value(); else yield String(value);
}
async function* jsonString(input: AsyncIterable<string>) {
  yield '"'; for await (const part of input) yield probeJsonString(part).slice(1, -1); yield '"';
}
async function* replace(input: AsyncIterable<string>, needle: string, replacement: string): AsyncGenerator<string> {
  let pending = "", first = true;
  if (!needle) {
    for await (const part of input) {
      let text = "";
      for (let i = 0; i < part.length; i++) { text += (first ? "" : replacement) + part[i]; first = false; if (text.length >= 4096) { yield text; text = ""; } }
      if (text) yield text;
    }
    return;
  }
  for await (const part of input) {
    const text = pending + part; let at = 0, found: number, output = "";
    while ((found = text.indexOf(needle, at)) >= 0) {
      output += text.slice(at, found) + replacement; at = found + needle.length;
      if (output.length >= 16384) { yield output; output = ""; }
    }
    const end = Math.max(at, text.length - needle.length + 1);
    output += text.slice(at, end);
    if (output) yield output;
    pending = text.slice(end);
  }
  if (pending) yield pending;
}
async function needsQuotes(input: AsyncIterable<string>, separator: string) {
  if (!separator) return true;
  let tail = "";
  for await (const part of input) {
    const text = tail + part;
    if (text.includes(separator) || text.includes('"') || text.includes("\n") || text.includes("\r")) return true;
    tail = text.slice(Math.max(0, text.length - separator.length + 1));
  }
  return false;
}

export type TaggedAudioRow = ReturnType<typeof audioProbeRows>[number] & { tags?: StoredAudioTags | undefined };

/** Replay scalar rows and tag spans without collecting tag maps or formatted output. */
export async function* formatTaggedAudio(audio: Omit<AudioAst, "data" | "nodes" | "pictures"> & { nodes?: AudioAst["nodes"] }, size: number, args: readonly string[], tags: StoredAudioTags, validation?: StringValidation): AsyncGenerator<string> {
  const parsed = parseArguments(args), rows = audioProbeRows({ ...audio, nodes: audio.nodes ?? [] }, size, parsed, tags.count > 0);
  yield* formatTaggedRows((async function* () { for (const row of rows) yield { ...row, tags }; })(), args, validation);
}

/** Rows may acquire per-stream indexes; iteration never collects the stream list. */
export async function* formatTaggedRows(rows: AsyncIterable<TaggedAudioRow>, args: readonly string[], validation?: StringValidation): AsyncGenerator<string> {
  const { sections, format, writer, settings, streamEntries } = parseArguments(args);
  const strings = validation ?? new StringValidation(writer);
  let tags: StoredAudioTags | undefined;
  async function* tagFields(section: string) {
    const selected = sections.get(section + "_tags");
    for await (const entry of tags?.entries() ?? []) {
      let included = selected === undefined;
      for (const wanted of selected ?? []) {
        let at = 0, matches = true;
        for await (const part of parts(entry.key)) {
          if (wanted.slice(at, at + part.length).toLowerCase() !== part.toLowerCase()) { matches = false; break; }
          at += part.length;
        }
        if (matches && at === wanted.length) { included = true; break; }
      }
      if (included && await strings.accepts(entry.key, entry.text)) yield { key: () => strings.text(entry.key), value: () => strings.text(entry.text) };
    }
  }
  async function* jsonRow(row: TaggedAudioRow["row"], section: string, indent: number): AsyncGenerator<string> {
    yield "{"; let first = true;
    for (const [key, value] of Object.entries(row)) {
      yield (first ? "\n" : ",\n") + " ".repeat(indent + 4) + JSON.stringify(key) + ": "; first = false;
      if (typeof value === "object") {
        yield "{"; let firstTag = true;
        for await (const field of tagFields(section)) {
          yield (firstTag ? "\n" : ",\n") + " ".repeat(indent + 8); firstTag = false;
          yield* jsonString(parts(field.key)); yield ": ";
          yield* jsonString(parts(field.value));
        }
        yield (firstTag ? "\n\n" : "\n") + " ".repeat(indent + 4) + "}";
      } else if (typeof value === "number") yield JSON.stringify(value);
      else yield* jsonString(parts(value));
    }
    yield (first ? "\n\n" : "\n") + " ".repeat(indent) + "}";
  }
  if (format === "json") {
    yield "{"; let first = true, streamOpen = (sections.has("stream") && sections.get("stream")?.length !== 0) || (sections.has("stream_tags") && sections.get("stream_tags")?.length !== 0), firstStream = true;
    if (streamOpen) {
      if (streamEntries) yield '\n    "programs": [\n\n    ],\n    "stream_groups": [\n\n    ],';
      yield '\n    "streams": ['; first = false;
    }
    for await (const entry of rows) {
      const { section, row } = entry; tags = entry.tags;
      if (section === "stream") {
        yield (firstStream ? "\n" : ",\n") + "        "; firstStream = false;
        yield* jsonRow(row, section, 8);
      } else if (section === "format") {
        if (streamOpen) { yield (firstStream ? "\n\n    " : "\n    ") + "]"; streamOpen = false; }
        yield (first ? "\n" : ",\n") + '    "format": '; first = false;
        yield* jsonRow(row, section, 4);
      }
    }
    if (streamOpen) yield (firstStream ? "\n\n    " : "\n    ") + "]";
    yield (first ? "\n\n" : "\n") + "}\n"; return;
  }
  const enabled = (key: string, fallback: boolean) => { const value = settings.get(key); return value === undefined ? fallback : parseWriterBoolean(value); };
  if (format === "ini") {
    yield "# ffprobe output\n";
    if (["stream", "stream_tags"].some(key => sections.has(key) && sections.get(key)?.length !== 0)) yield "\n\n";
  }
  let streamIndex = 0;
  for await (const entry of rows) {
    const { section, row } = entry; tags = entry.tags;
    async function* fields(): AsyncGenerator<{ key: Text; value: Value; tag?: boolean }> {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "object") { for await (const tag of tagFields(section)) yield { key: tag.key, value: tag.value, tag: true }; }
        else yield { key, value };
      }
    }
    if (format === "ini") {
      const path = section === "stream" ? `${!parseWriterBoolean(settings.get("hierarchical") ?? "1") ? "" : "streams."}stream.${streamIndex++}` : section;
      yield `\n[${path}]\n`;
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "object") continue;
        yield escapeIni(key) + "=" + escapeIni(String(value)) + "\n";
      }
      if (row.tags) {
        yield `[${path}.tags]\n`;
        for await (const field of tagFields(section)) {
          for await (const part of parts(field.key)) yield escapeIni(part);
          yield "=";
          for await (const part of parts(field.value)) yield escapeIni(part);
          yield "\n";
        }
      }
    } else if (format === "compact" || format === "csv") {
      const separator = settings.get("item_sep") ?? (format === "csv" ? "," : "|");
      let first = true;
      if (enabled("print_section", true)) { yield section; first = false; }
      for await (const field of fields()) {
        if (!first) yield separator; first = false;
        if (!enabled("nokey", format === "csv")) {
          if (field.tag) yield "tag:";
          yield* parts(field.key); yield "=";
        }
        const escape = settings.get("escape") ?? (format === "csv" ? "csv" : "c");
        if (escape === "none") yield* parts(field.value);
        else if (escape === "csv") {
          const quote = await needsQuotes(parts(field.value), separator);
          if (quote) yield '"';
          yield* quote ? replace(parts(field.value), '"', '""') : parts(field.value);
          if (quote) yield '"';
        } else yield* replace(replace(replace(replace(parts(field.value), "\\", "\\\\"), "\n", "\\n"), "\r", "\\r"), separator, "\\" + separator);
      }
      yield "\n";
    } else if (format === "flat") {
      const sep = settings.get("sep_char") ?? ".";
      const prefix = section === "stream" ? `${!parseWriterBoolean(settings.get("hierarchical") ?? "1") ? "" : "streams" + sep}stream${sep}${streamIndex++}` : "format";
      for await (const field of fields()) {
        yield prefix + sep + (field.tag ? "tags" + sep : ""); yield* parts(field.key); yield "=";
        if (typeof field.value === "number") yield String(field.value);
        else {
          yield '"';
          yield* replace(replace(replace(replace(parts(field.value), "\\", "\\\\"), '"', '\\"'), "\n", "\\n"), "\r", "\\r");
          yield '"';
        }
        yield "\n";
      }
    } else {
      if (!enabled("noprint_wrappers", false)) yield "[" + section.toUpperCase() + "]\n";
      for await (const field of fields()) {
        if (!enabled("nokey", false)) { if (field.tag) yield "TAG:"; yield* parts(field.key); yield "="; }
        yield* parts(field.value); yield "\n";
      }
      if (!enabled("noprint_wrappers", false)) yield "[/" + section.toUpperCase() + "]\n";
    }
  }
}
