import type { RetainedInfoUpdate } from "@poe-code/pdf-ast";
import { decodePdftkEntities, hexToBytes } from "./info-text.js";

const styles: Readonly<Record<string, string>> = { DecimalArabicNumerals: "D", UppercaseRomanNumerals: "R", LowercaseRomanNumerals: "r", UppercaseLetters: "A", LowercaseLetters: "a" };

async function* lines(chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder(); let pending = "", work = 0;
  for await (const bytes of chunks) {
    signal.throwIfAborted(); pending += decoder.decode(bytes, { stream: true });
    let offset = 0, end: number;
    while ((end = pending.indexOf("\n", offset)) >= 0) {
      if (++work % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
      yield pending.slice(offset, end); offset = end + 1;
    }
    pending = pending.slice(offset);
  }
  pending += decoder.decode(); if (pending) yield pending;
}

export async function* retainedInfoUpdates(chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncGenerator<RetainedInfoUpdate> {
  let mode: "none" | "info" | "bookmark" | "pagelabel" | "pagemedia" = "none";
  let curKey = "";
  let bmTitle = "";
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

  for await (const raw of lines(chunks, signal)) {
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
    } else if (mode === "bookmark" && line.startsWith("BookmarkTitle:")) {
      bmTitle = decodePdftkEntities(line.slice("BookmarkTitle:".length).trim());
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
}
