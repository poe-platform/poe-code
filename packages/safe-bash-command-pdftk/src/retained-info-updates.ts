import { decodePdftkEntityChunks } from "./info-entity-stream.js";
import { PdfTextStore, type PdfIndexStorage, type RetainedInfoUpdate } from "@poe-code/pdf-ast";
import { decodePdftkEntities, hexToBytes } from "./info-text.js";

const styles: Readonly<Record<string, string>> = { DecimalArabicNumerals: "D", UppercaseRomanNumerals: "R", LowercaseRomanNumerals: "r", UppercaseLetters: "A", LowercaseLetters: "a" };

async function* lines(chunks: AsyncIterable<Uint8Array>, texts: PdfTextStore, signal: AbortSignal): AsyncGenerator<string | { title: () => AsyncGenerator<string, void, void> }> {
  async function* decoded() {
    const decoder = new TextDecoder();
    for await (const bytes of chunks) for (let at = 0; at < bytes.length; at += 4096) {
      signal.throwIfAborted(); yield decoder.decode(bytes.subarray(at, at + 4096), { stream: true });
    }
    yield decoder.decode();
  }
  const input = decoded(); let buffer = "", offset = 0, ended = false, failed = false;
  async function* line() {
    while (!ended || offset < buffer.length) {
      if (offset === buffer.length) { const next = await input.next(); ended = !!next.done; buffer = next.value ?? ""; offset = 0; if (ended) return; }
      const end = buffer.indexOf("\n", offset);
      if (end >= 0) { yield buffer.slice(offset, end); offset = end + 1; return; }
      yield buffer.slice(offset); offset = buffer.length;
    }
  }
  try {
    while (!ended || offset < buffer.length) {
      const id = await texts.append(line()); let start = -1, end = 0, position = 0, head = "";
      for await (const part of texts.text(id)) {
        for (let at = 0; at < part.length; at++) {
          const character = part[at]!;
          if (character.trim()) { if (start < 0) start = position; end = position + 1; }
          if (start >= 0 && head.length < 64) head += character;
          position++;
        }
      }
      async function* field(skip: number) {
        let position = 0, leading = true;
        for await (const part of texts.text(id)) {
          const from = Math.max(0, start + skip - position), to = Math.min(part.length, end - position);
          if (to > from) {
            let value = part.slice(from, to);
            if (leading) { value = value.trimStart(); leading = !value.length; }
            if (value) yield value;
          }
          position += part.length; if (position >= end) break;
        }
      }
      if (head.startsWith("BookmarkTitle:")) {
        let body = start + "BookmarkTitle:".length;
        for await (const part of texts.text(id, body)) {
          const value = part.trimStart(); body += part.length - value.length; if (value) break;
        }
        async function* readTitle(offset: number) {
          let position = body + offset;
          for await (const part of texts.text(id, position)) {
            const length = Math.min(part.length, end - position); if (length <= 0) break;
            yield part.slice(0, length); position += length; if (position >= end) break;
          }
        }
        yield { title: () => decodePdftkEntityChunks(readTitle, signal) };
      }
      else {
        // Unknown lines are ignored without collecting their contents. The
        // remaining scalar update fields keep their existing conversion rules.
        const begin = ["InfoBegin", "BookmarkBegin", "PageLabelBegin", "PageMediaBegin"].some(name => end - start === name.length && head.startsWith(name));
        const known = ["PdfID0:", "PdfID1:", "InfoKey:", "InfoValue:", "BookmarkLevel:", "BookmarkPageNumber:", "PageLabelNewIndex:", "PageLabelStart:", "PageLabelPrefix:", "PageLabelNumStyle:", "PageMediaNumber:", "PageMediaRotation:", "PageMediaRect:", "PageMediaDimensions:", "PageMediaCropBox:", "PageMediaCropRect:"].some(name => head.startsWith(name));
        if (!begin && !known) continue;
        let text = ""; for await (const part of field(0)) text += part; yield text;
      }
    }
  } catch (error) { failed = true; throw error; }
  finally { await input.return().catch(error => { if (!failed) throw error; }); }
}

export async function* retainedInfoUpdates(chunks: AsyncIterable<Uint8Array>, signal: AbortSignal, storage: PdfIndexStorage): AsyncGenerator<RetainedInfoUpdate> {
  const texts = new PdfTextStore(storage, { signal }); let failed = false;
  try {
  let mode: "none" | "info" | "bookmark" | "pagelabel" | "pagemedia" = "none";
  let curKey = "";
  let bmTitle: string | (() => AsyncIterable<string>) = "";
  let bmLevel = 1;
  let bmPage = 1;
  const pending: RetainedInfoUpdate[] = [];

  let plNewIndex = 1;
  let plStart = 1;
  let plPrefix = "";
  let plStyle = "DecimalArabicNumerals";

  let pmNumber = 0;
  let pmRotation: number | undefined;
  let pmMediaRect: [number, number, number, number] | undefined;
  let pmDimensions: [number, number] | undefined;
  let pmCropBox: [number, number, number, number] | undefined;

  const flushStanza = () => {
    if (mode === "bookmark" && bmTitle) {
      pending.push({ kind: "bookmark", title: bmTitle, level: Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, bmLevel)), pageNumber: Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, bmPage)) });
    } else if (mode === "pagelabel") {
      pending.push({
        kind: "label", index: Math.max(0, plNewIndex - 1),
        start: Math.max(1, plStart),
        prefix: plPrefix,
        ...(styles[plStyle] ? { style: styles[plStyle]! } : {}),
      });
    } else if (mode === "pagemedia" && pmNumber >= 1) {
      if (pmRotation !== undefined) pending.push({ kind: "page", pageNumber: pmNumber, property: "rotation", values: [Number.isFinite(pmRotation) ? pmRotation : 0] });
      if (pmMediaRect !== undefined) pending.push({ kind: "page", pageNumber: pmNumber, property: "media", values: pmMediaRect });
      if (pmDimensions !== undefined) pending.push({ kind: "page", pageNumber: pmNumber, property: "dimensions", values: pmDimensions });
      if (pmCropBox !== undefined) pending.push({ kind: "page", pageNumber: pmNumber, property: "crop", values: pmCropBox });
    }
    bmTitle = "";
    bmLevel = 1;
    bmPage = 1;
    plNewIndex = 1;
    plStart = 1;
    plPrefix = "";
    plStyle = "DecimalArabicNumerals";
    pmNumber = 0;
    pmRotation = undefined;
    pmMediaRect = undefined;
    pmDimensions = undefined;
    pmCropBox = undefined;
  };

  for await (const raw of lines(chunks, texts, signal)) {
    if (typeof raw !== "string") {
      if (mode === "bookmark") {
        let nonempty = false; for await (const part of raw.title()) nonempty ||= !!part.length;
        bmTitle = nonempty ? raw.title : "";
      }
      continue;
    }
    const line = raw.trim();
    if (line === "InfoBegin") {
      flushStanza();
      yield* pending; pending.length = 0;
      mode = "info";
      curKey = "";
    } else if (line === "BookmarkBegin") {
      flushStanza();
      yield* pending; pending.length = 0;
      mode = "bookmark";
    } else if (line === "PageLabelBegin") {
      flushStanza();
      yield* pending; pending.length = 0;
      mode = "pagelabel";
    } else if (line === "PageMediaBegin") {
      flushStanza();
      yield* pending; pending.length = 0;
      mode = "pagemedia";
    } else if (line.startsWith("PdfID0:")) {
      yield { kind: "id", index: 0, bytes: hexToBytes(line.slice("PdfID0:".length)) };
    } else if (line.startsWith("PdfID1:")) {
      yield { kind: "id", index: 1, bytes: hexToBytes(line.slice("PdfID1:".length)) };
    } else if (mode === "info" && line.startsWith("InfoKey:")) {
      curKey = decodePdftkEntities(line.slice("InfoKey:".length).trim());
    } else if (mode === "info" && line.startsWith("InfoValue:") && curKey) {
      const val = decodePdftkEntities(line.slice("InfoValue:".length).trim());
      yield { kind: "info", key: curKey, value: val };
      mode = "none";
      curKey = "";

    } else if (mode === "bookmark" && line.startsWith("BookmarkLevel:")) {
      bmLevel = Number.parseInt(line.slice("BookmarkLevel:".length).trim(), 10) || 1;
    } else if (mode === "bookmark" && line.startsWith("BookmarkPageNumber:")) {
      bmPage = Number.parseInt(line.slice("BookmarkPageNumber:".length).trim(), 10) || 1;
    } else if (mode === "pagelabel" && line.startsWith("PageLabelNewIndex:")) {
      plNewIndex = Number.parseInt(line.slice("PageLabelNewIndex:".length).trim(), 10) || 1;
    } else if (mode === "pagelabel" && line.startsWith("PageLabelStart:")) {
      plStart = Number.parseInt(line.slice("PageLabelStart:".length).trim(), 10) || 1;
    } else if (mode === "pagelabel" && line.startsWith("PageLabelPrefix:")) {
      plPrefix = decodePdftkEntities(line.slice("PageLabelPrefix:".length).trim());
    } else if (mode === "pagelabel" && line.startsWith("PageLabelNumStyle:")) {
      plStyle = line.slice("PageLabelNumStyle:".length).trim();
    } else if (mode === "pagemedia" && line.startsWith("PageMediaNumber:")) {
      pmNumber = Number.parseInt(line.slice("PageMediaNumber:".length).trim(), 10) || 0;
    } else if (mode === "pagemedia" && line.startsWith("PageMediaRotation:")) {
      pmRotation = Number.parseInt(line.slice("PageMediaRotation:".length).trim(), 10) || 0;
    } else if (mode === "pagemedia" && line.startsWith("PageMediaRect:")) {
      const parts = line.slice("PageMediaRect:".length).trim().split(" ").filter(Boolean).map(Number);
      if (parts.length >= 4 && parts.every(Number.isFinite)) {
        pmMediaRect = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
      }
    } else if (mode === "pagemedia" && line.startsWith("PageMediaDimensions:")) {
      const parts = line.slice("PageMediaDimensions:".length).trim().split(" ").filter(Boolean).map(Number);
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        pmDimensions = [parts[0]!, parts[1]!];
      }
    } else if (
      mode === "pagemedia" &&
      (line.startsWith("PageMediaCropBox:") || line.startsWith("PageMediaCropRect:"))
    ) {
      const prefix = line.startsWith("PageMediaCropRect:") ? "PageMediaCropRect:" : "PageMediaCropBox:";
      const parts = line.slice(prefix.length).trim().split(" ").filter(Boolean).map(Number);
      if (parts.length >= 4 && parts.every(Number.isFinite)) {
        pmCropBox = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
      }
    }
  }
  flushStanza();
  yield* pending;
  } catch (error) { failed = true; throw error; }
  finally { await texts.close().catch(error => { if (!failed) throw error; }); }
}
