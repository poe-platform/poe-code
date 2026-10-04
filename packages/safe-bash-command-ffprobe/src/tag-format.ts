import type { AudioAst } from "@poe-code/audio-ast";
import { audioProbeRows, parseArguments } from "./probe.js";
import type { WavTags } from "./wav-tags.js";

type Value = string | number | (() => AsyncIterable<string>);
async function* parts(value: Value, prefix = ""): AsyncGenerator<string> {
  if (prefix) yield prefix;
  if (typeof value === "function") yield* value(); else yield String(value);
}
async function* jsonString(input: AsyncIterable<string>) {
  yield '"'; for await (const part of input) yield JSON.stringify(part).slice(1, -1); yield '"';
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
    if (text.includes(separator) || text.includes('"') || text.includes("\n")) return true;
    tail = text.slice(Math.max(0, text.length - separator.length + 1));
  }
  return false;
}

/** Replay scalar rows and tag spans without collecting tag maps or formatted output. */
export async function* formatTaggedAudio(audio: Omit<AudioAst, "data" | "nodes" | "pictures">, size: number, args: readonly string[], tags: WavTags): AsyncGenerator<string> {
  const parsed = parseArguments(args), { sections, format, settings } = parsed;
  const rows = audioProbeRows({ ...audio, nodes: [] }, size, parsed, tags.count > 0);
  async function* tagFields(section: string) {
    const selected = sections.get(section + "_tags");
    for await (const entry of tags.entries()) if (selected === undefined || selected.includes(entry.key)) yield { key: entry.key, value: entry.text };
  }
  async function* jsonRow(row: typeof rows[number]["row"], section: string, indent: number): AsyncGenerator<string> {
    yield "{"; let first = true;
    for (const [key, value] of Object.entries(row)) {
      yield (first ? "\n" : ",\n") + " ".repeat(indent + 4) + JSON.stringify(key) + ": "; first = false;
      if (typeof value === "object") {
        yield "{"; let firstTag = true;
        for await (const field of tagFields(section)) {
          yield (firstTag ? "\n" : ",\n") + " ".repeat(indent + 8) + JSON.stringify(field.key) + ": "; firstTag = false;
          yield* jsonString(parts(field.value));
        }
        yield (firstTag ? "" : "\n" + " ".repeat(indent + 4)) + "}";
      } else if (typeof value === "number") yield JSON.stringify(value);
      else yield* jsonString(parts(value));
    }
    yield (first ? "" : "\n" + " ".repeat(indent)) + "}";
  }
  if (format === "json") {
    yield "{"; let first = true;
    if (sections.has("stream") || sections.has("stream_tags")) {
      yield '\n    "streams": ['; first = false;
      let firstStream = true;
      for (const { section, row } of rows) if (section === "stream") {
        yield (firstStream ? "\n" : ",\n") + "        "; firstStream = false;
        yield* jsonRow(row, section, 8);
      }
      yield (firstStream ? "" : "\n    ") + "]";
    }
    for (const { section, row } of rows) if (section === "format") {
      yield (first ? "\n" : ",\n") + '    "format": '; first = false;
      yield* jsonRow(row, section, 4);
    }
    yield (first ? "" : "\n") + "}\n"; return;
  }
  const enabled = (a: string, b: string, fallback: boolean) => { const value = settings.get(a) ?? settings.get(b); return value === undefined ? fallback : value === "1"; };
  let streamIndex = 0;
  for (const { section, row } of rows) {
    async function* fields(): AsyncGenerator<{ key: string; value: Value }> {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "object") { for await (const tag of tagFields(section)) yield { key: "tag:" + tag.key, value: tag.value }; }
        else yield { key, value };
      }
    }
    if (format === "compact" || format === "csv") {
      const separator = settings.get("item_sep") ?? settings.get("s") ?? (format === "csv" ? "," : "|");
      let first = true;
      if (enabled("print_section", "p", true)) { yield section; first = false; }
      for await (const field of fields()) {
        if (!first) yield separator; first = false;
        const prefix = enabled("nokey", "nk", format === "csv") ? "" : field.key + "=";
        if (format === "csv") {
          const quote = await needsQuotes(parts(field.value, prefix), separator);
          if (quote) yield '"';
          yield* quote ? replace(parts(field.value, prefix), '"', '""') : parts(field.value, prefix);
          if (quote) yield '"';
        } else yield* replace(replace(replace(replace(parts(field.value, prefix), "\\", "\\\\"), "\n", "\\n"), "\r", "\\r"), separator, "\\" + separator);
      }
      yield "\n";
    } else if (format === "flat") {
      const prefix = section === "stream" ? `streams.stream.${streamIndex++}` : "format";
      for await (const field of fields()) {
        yield prefix + "." + (field.key.startsWith("tag:") ? "tags." + field.key.slice(4) : field.key) + "=";
        if (typeof field.value === "number") yield String(field.value); else yield* jsonString(parts(field.value));
        yield "\n";
      }
    } else {
      if (!enabled("noprint_wrappers", "nw", false)) yield "[" + section.toUpperCase() + "]\n";
      for await (const field of fields()) {
        if (!enabled("nokey", "nk", false)) yield (field.key.startsWith("tag:") ? "TAG:" + field.key.slice(4) : field.key) + "=";
        yield* parts(field.value); yield "\n";
      }
      if (!enabled("noprint_wrappers", "nw", false)) yield "[/" + section.toUpperCase() + "]\n";
    }
  }
}
