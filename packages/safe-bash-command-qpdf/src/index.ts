import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import {
  PdfDocument,
  parseCosDocument,
  serializeCosDocument,
  encryptCosDocument,
  generateDocumentFormAppearances,
  resolveDestinationPageIndex,
  decodePdfString,
  cosDict,
  cosNumber,
  cosArray,
  cosName,
  cosString,
  cosHexString,
  cosStream,
  dictGet,
  dictSet,
  dictDelete,
  type PdfCosNode,
  type PdfCosDict,
  type PdfCosRef,
  type PdfDictEntry
} from "@poe-code/pdf-ast";

const asDict = (n: PdfCosNode | undefined): PdfCosDict | undefined => (n?.kind === "dict" ? n : undefined);
const asArray = (n: PdfCosNode | undefined) => (n?.kind === "array" ? n : undefined);
const asNumber = (n: PdfCosNode | undefined) => (n?.kind === "number" ? n : undefined);
const asName = (n: PdfCosNode | undefined) => (n?.kind === "name" ? n : undefined);
const asRef = (n: PdfCosNode | undefined) => (n?.kind === "ref" ? n : undefined);

function isPdfDelimiterOrSpace(ch: string | undefined): boolean {
  if (!ch) return true;
  return (
    ch === " " ||
    ch === "\t" ||
    ch === "\n" ||
    ch === "\r" ||
    ch === "/" ||
    ch === "<" ||
    ch === ">" ||
    ch === "[" ||
    ch === "]" ||
    ch === "(" ||
    ch === ")"
  );
}

function bytesToIso88591(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function iso88591ToBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function replacePdfNameToken(content: string, oldName: string, newName: string): string {
  const needle = `/${oldName}`;
  let out = "";
  let i = 0;
  while (i < content.length) {
    const idx = content.indexOf(needle, i);
    if (idx === -1) {
      out += content.slice(i);
      break;
    }
    const afterChar = content[idx + needle.length];
    if (isPdfDelimiterOrSpace(afterChar)) {
      out += content.slice(i, idx) + `/${newName}`;
      i = idx + needle.length;
    } else {
      out += content.slice(i, idx + needle.length);
      i = idx + needle.length;
    }
  }
  return out;
}

export interface QpdfCommandOptions {
  readonly replace?: boolean;
}

export interface QpdfCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function parseSingleTokenPageNumber(tok: string, totalPages: number): number {
  const trimmed = tok.trim();
  if (trimmed === "z") return totalPages;
  if (trimmed.startsWith("r")) {
    const rev = Number.parseInt(trimmed.slice(1), 10);
    if (!Number.isFinite(rev) || rev < 1 || rev > totalPages) {
      throw new Error(`Invalid reverse page number '${tok}'`);
    }
    return totalPages - rev + 1;
  }
  const num = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(num) || num < 1 || num > totalPages) {
    throw new Error(`Page number '${tok}' out of bounds (1..${totalPages})`);
  }
  return num;
}

export function parseQpdfPageRange(rangeSpec: string, totalPages: number): number[] {
  const spec = rangeSpec.trim();

  const expandSubRange = (rawPart: string): { pages: number[]; trailingGroupParity?: "odd" | "even" | undefined } => {
    let part = rawPart.trim();
    let partParity: "odd" | "even" | undefined;
    if (part.endsWith(":odd")) {
      partParity = "odd";
      part = part.slice(0, -4);
    } else if (part.endsWith(":even")) {
      partParity = "even";
      part = part.slice(0, -5);
    }
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-", 2);
      const start = parseSingleTokenPageNumber(startStr ?? "1", totalPages);
      const end = parseSingleTokenPageNumber(endStr ?? "z", totalPages);
      let out: number[] = [];
      if (start <= end) {
        for (let p = start; p <= end; p++) out.push(p);
      } else {
        for (let p = start; p >= end; p--) out.push(p);
      }
      if (partParity === "odd") {
        out = out.filter((_, idx) => idx % 2 === 0);
      } else if (partParity === "even") {
        out = out.filter((_, idx) => idx % 2 === 1);
      }
      return { pages: out };
    }
    return {
      pages: [parseSingleTokenPageNumber(part, totalPages)],
      trailingGroupParity: partParity,
    };
  };

  let pages: number[] = [];
  let parity: "odd" | "even" | undefined;
  const parts = spec.split(",").filter((s) => s.length > 0);
  for (const part of parts) {
    if (part.startsWith("x")) {
      const excluded = new Set(expandSubRange(part.slice(1)).pages);
      pages = pages.filter((p) => !excluded.has(p));
    } else {
      const expanded = expandSubRange(part);
      pages.push(...expanded.pages);
      if (expanded.trailingGroupParity) {
        parity = expanded.trailingGroupParity;
      }
    }
  }

  if (parity === "odd") {
    pages = pages.filter((_, idx) => idx % 2 === 0);
  } else if (parity === "even") {
    pages = pages.filter((_, idx) => idx % 2 === 1);
  }
  return pages;
}

function formatCosNodeForDisplay(node: PdfCosNode | undefined): string {
  if (!node) return "null";
  switch (node.kind) {
    case "null":
      return "null";
    case "boolean":
      return node.value ? "true" : "false";
    case "number":
      return String(node.value);
    case "name":
      return `/${node.decoded}`;
    case "string":
      return `(${decodePdfString(node)})`;
    case "ref":
      return `${node.objectNumber} ${node.generationNumber} R`;
    case "array":
      return `[ ${node.items.map(formatCosNodeForDisplay).join(" ")} ]`;
    case "dict": {
      const inner = node.entries
        .map((e) => `/${e.key.decoded} ${formatCosNodeForDisplay(e.value)}`)
        .join(" ");
      return `<< ${inner} >>`;
    }
    case "stream":
      return `${formatCosNodeForDisplay(node.dict)}\nstream\n...(${node.rawBytes.byteLength} bytes)...\nendstream`;
  }
}

function cosNodeToJson(node: PdfCosNode | undefined): unknown {
  if (!node) return null;
  switch (node.kind) {
    case "null":
      return null;
    case "boolean":
      return node.value;
    case "number":
      return node.value;
    case "name":
      return `/${node.decoded}`;
    case "string":
      return `u:${decodePdfString(node)}`;
    case "ref":
      return `${node.objectNumber} ${node.generationNumber} R`;
    case "array":
      return node.items.map(cosNodeToJson);
    case "dict": {
      const obj: Record<string, unknown> = {};
      for (const entry of node.entries) {
        obj[`/${entry.key.decoded}`] = cosNodeToJson(entry.value);
      }
      return obj;
    }
    case "stream":
      return {
        dict: cosNodeToJson(node.dict),
        length: node.rawBytes.byteLength
      };
  }
}

interface PageSelectionSpec {
  file: string;
  password?: string;
  range: string;
}

interface RotateSpec {
  angle: 0 | 90 | 180 | 270;
  relative: boolean;
  sign: 1 | -1;
  range: string;
}

interface StampSpec {
  mode: "overlay" | "underlay";
  file: string;
  password?: string;
  fromRange: string;
  toRange: string;
  repeatRange?: string;
}

interface AddAttachmentSpec {
  file: string;
  key: string;
  filename: string;
  description?: string;
  replace?: boolean;
}

interface CopyAttachmentsSpec {
  file: string;
  prefix: string;
  password?: string;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBytesBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f]!;
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f]!;
    out += hasB1 ? BASE64_ALPHABET[(triple >> 6) & 0x3f]! : "=";
    out += hasB2 ? BASE64_ALPHABET[triple & 0x3f]! : "=";
  }
  return out;
}

function decodeBytesBase64(b64: string): Uint8Array {
  const clean: number[] = [];
  for (let i = 0; i < b64.length; i++) {
    const ch = b64[i]!;
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "=") continue;
    const idx = BASE64_ALPHABET.indexOf(ch);
    if (idx >= 0) clean.push(idx);
  }
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean[i] ?? 0;
    const c1 = clean[i + 1] ?? 0;
    const c2 = clean[i + 2] ?? 0;
    const c3 = clean[i + 3] ?? 0;
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIdx < outLen) out[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < outLen) out[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < outLen) out[outIdx++] = triple & 0xff;
  }
  return out;
}

function hexStrToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const v = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isNaN(v) ? 0 : v;
  }
  return out;
}

function parseJsonRefToken(raw: string): PdfCosRef | undefined {
  const trimmed = raw.startsWith("obj:") ? raw.slice(4).trim() : raw.trim();
  const parts = trimmed.split(" ").filter((p) => p.length > 0);
  if (parts.length !== 3 || (parts[2] !== "R" && parts[2] !== "obj")) return undefined;
  const sel = parseStrictJsonObjectSelector(`${parts[0]},${parts[1]}`);
  if (!sel || sel.kind !== "obj") return undefined;
  return { kind: "ref", objectNumber: sel.objNum, generationNumber: sel.genNum };
}

function jsonToCosNode(val: unknown): PdfCosNode {
  if (val === null || val === undefined) return { kind: "null" };
  if (typeof val === "boolean") return { kind: "boolean", value: val };
  if (typeof val === "number") return cosNumber(val);
  if (typeof val === "string") {
    if (val.startsWith("n:/")) return cosName(val.slice(3));
    if (val.startsWith("n:")) return cosName(val.slice(2));
    if (val.startsWith("/")) return cosName(val.slice(1));
    if (val.startsWith("u:")) return cosString(val.slice(2));
    if (val.startsWith("b:")) return cosHexString(hexStrToBytes(val.slice(2)));
    const maybeRef = parseJsonRefToken(val);
    if (maybeRef) return maybeRef;
    return cosString(val);
  }
  if (Array.isArray(val)) {
    return cosArray(val.map(jsonToCosNode));
  }
  if (typeof val === "object") {
    const d = cosDict({});
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const keyName = k.startsWith("n:/") ? k.slice(3) : k.startsWith("/") ? k.slice(1) : k;
      dictSet(d, keyName, jsonToCosNode(v));
    }
    return d;
  }
  return { kind: "null" };
}

const DECOMPRESSIBLE_FILTERS = new Set([
  "FlateDecode",
  "ASCIIHexDecode",
  "ASCII85Decode",
  "LZWDecode",
  "RunLengthDecode",
]);

function applyQpdfJsonObjects(
  targetObjects: Map<number, { objectNumber: number; generationNumber: number; value: PdfCosNode }>,
  parsedJson: unknown,
  files: ReadonlyMap<string, Uint8Array>
): { rootRef?: PdfCosRef | undefined; infoRef?: PdfCosRef | undefined } {
  if (typeof parsedJson !== "object" || parsedJson === null) {
    throw new Error("Invalid QPDF JSON root");
  }
  const rootObj = parsedJson as Record<string, unknown>;
  let objectsSection: Record<string, unknown> | undefined;
  if (Array.isArray(rootObj.qpdf) && rootObj.qpdf.length >= 2 && typeof rootObj.qpdf[1] === "object") {
    objectsSection = rootObj.qpdf[1] as Record<string, unknown>;
  } else if (typeof rootObj.objects === "object" && rootObj.objects !== null) {
    objectsSection = rootObj.objects as Record<string, unknown>;
  }
  if (!objectsSection) {
    throw new Error("Missing QPDF JSON objects section");
  }

  let rootRef: PdfCosRef | undefined;
  let infoRef: PdfCosRef | undefined;

  for (const [objKey, rawEntry] of Object.entries(objectsSection)) {
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const entry = rawEntry as Record<string, unknown>;
    if (objKey === "trailer") {
      const trVal = jsonToCosNode(entry.value);
      if (trVal.kind === "dict") {
        const rNode = dictGet(trVal, "Root");
        if (rNode?.kind === "ref") rootRef = rNode;
        const iNode = dictGet(trVal, "Info");
        if (iNode?.kind === "ref") infoRef = iNode;
      }
      continue;
    }
    const ref = parseJsonRefToken(objKey);
    if (!ref) continue;
    if ("stream" in entry && typeof entry.stream === "object" && entry.stream !== null) {
      const stObj = entry.stream as Record<string, unknown>;
      const dictConverted = jsonToCosNode(stObj.dict ?? {});
      const stDict = dictConverted.kind === "dict" ? dictConverted : cosDict({});
      let streamBytes: Uint8Array;
      if (typeof stObj.data === "string") {
        streamBytes = decodeBytesBase64(stObj.data);
      } else if (typeof stObj.datafile === "string") {
        const df = files.get(stObj.datafile);
        if (!df) {
          throw new Error(`cannot open stream datafile ${stObj.datafile}`);
        }
        streamBytes = df;
      } else {
        const existing = targetObjects.get(ref.objectNumber)?.value;
        streamBytes = existing?.kind === "stream" ? existing.rawBytes : new Uint8Array(0);
      }
      const filterNode = dictGet(stDict, "Filter");
      const shouldStripFilter =
        (filterNode?.kind === "name" && DECOMPRESSIBLE_FILTERS.has(filterNode.decoded)) ||
        (filterNode?.kind === "array" &&
          filterNode.items.every((it) => it.kind === "name" && DECOMPRESSIBLE_FILTERS.has(it.decoded)));
      if (shouldStripFilter) {
        dictDelete(stDict, "Filter");
        dictDelete(stDict, "DecodeParms");
      }
      dictSet(stDict, "Length", cosNumber(streamBytes.byteLength));
      targetObjects.set(ref.objectNumber, {
        objectNumber: ref.objectNumber,
        generationNumber: ref.generationNumber,
        value: cosStream(streamBytes, { dict: stDict, compress: false }),
      });
    } else if ("value" in entry) {
      if (entry.value === null) {
        targetObjects.delete(ref.objectNumber);
      } else {
        targetObjects.set(ref.objectNumber, {
          objectNumber: ref.objectNumber,
          generationNumber: ref.generationNumber,
          value: jsonToCosNode(entry.value),
        });
      }
    }
  }

  if (!rootRef) {
    for (const obj of targetObjects.values()) {
      if (obj.value.kind === "dict") {
        const t = dictGet(obj.value, "Type");
        if (t?.kind === "name" && t.decoded === "Catalog") {
          rootRef = { kind: "ref", objectNumber: obj.objectNumber, generationNumber: obj.generationNumber };
          break;
        }
      }
    }
  }

  return { rootRef, infoRef };
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function parseStrictJsonObjectSelector(
  raw: string
): { kind: "trailer" } | { kind: "obj"; objNum: number; genNum: number } | undefined {
  if (raw === "trailer") return { kind: "trailer" };
  if (raw.length === 0) return undefined;
  const commaIdx = raw.indexOf(",");
  const objStr = commaIdx >= 0 ? raw.slice(0, commaIdx) : raw;
  const genStr = commaIdx >= 0 ? raw.slice(commaIdx + 1) : "0";
  if (commaIdx >= 0 && genStr.includes(",")) return undefined;
  if (objStr.length === 0 || genStr.length === 0) return undefined;
  for (let i = 0; i < objStr.length; i++) {
    const c = objStr.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return undefined;
  }
  for (let i = 0; i < genStr.length; i++) {
    const c = genStr.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return undefined;
  }
  const objNum = Number.parseInt(objStr, 10);
  const genNum = Number.parseInt(genStr, 10);
  if (!Number.isSafeInteger(objNum) || objNum <= 0 || objNum > 2147483647) return undefined;
  if (!Number.isSafeInteger(genNum) || genNum < 0 || genNum > 65535) return undefined;
  return { kind: "obj", objNum, genNum };
}

interface EncryptConfig {
  userPassword: string;
  ownerPassword: string;
  keyLength: number;
  print: boolean;
  modify: boolean;
  copy: boolean;
  addNotes: boolean;
}


function collectDocumentAttachments(doc: PdfDocument): { key: string; filename: string; data: Uint8Array }[] {
  const entries: { key: string; filename: string; data: Uint8Array }[] = [];
  const seenKeys = new Set<string>();
  const pushFilespec = (fsDict: PdfCosDict | undefined, fallbackKey: string) => {
    if (!fsDict) return;
    const ufNode = doc.cos.resolve(dictGet(fsDict, "UF") ?? dictGet(fsDict, "F"));
    const fnStr = ufNode?.kind === "string" ? decodePdfString(ufNode) : fallbackKey;
    const keyStr = fallbackKey || fnStr;
    if (seenKeys.has(keyStr)) return;
    const efDict = asDict(doc.cos.resolve(dictGet(fsDict, "EF")));
    const stNode = efDict
      ? doc.cos.resolve(
          dictGet(efDict, "UF") ??
            dictGet(efDict, "F") ??
            dictGet(efDict, "DOS") ??
            dictGet(efDict, "Mac") ??
            dictGet(efDict, "Unix")
        )
      : undefined;
    if (stNode?.kind === "stream") {
      seenKeys.add(keyStr);
      entries.push({ key: keyStr, filename: fnStr, data: doc.cos.decodeStream(stNode) });
    }
  };
  const walkNames = (nodeDict: PdfCosDict | undefined, visited = new Set<number>()) => {
    if (!nodeDict) return;
    const namesArr = asArray(doc.cos.resolve(dictGet(nodeDict, "Names")));
    if (namesArr) {
      for (let idx = 0; idx + 1 < namesArr.items.length; idx += 2) {
        const kNode = doc.cos.resolve(namesArr.items[idx]);
        const keyStr = kNode?.kind === "string" ? decodePdfString(kNode) : `att_${idx}`;
        const fsDict = asDict(doc.cos.resolve(namesArr.items[idx + 1]));
        pushFilespec(fsDict, keyStr);
      }
    }
    const kidsArr = asArray(doc.cos.resolve(dictGet(nodeDict, "Kids")));
    if (kidsArr) {
      for (const kid of kidsArr.items) {
        if (kid.kind === "ref") {
          if (visited.has(kid.objectNumber)) continue;
          visited.add(kid.objectNumber);
        }
        walkNames(asDict(doc.cos.resolve(kid)), visited);
      }
    }
  };
  const rootDict = asDict(doc.cos.resolve(doc.cos.rootRef));
  const namesRoot = rootDict ? asDict(doc.cos.resolve(dictGet(rootDict, "Names"))) : undefined;
  walkNames(namesRoot ? asDict(doc.cos.resolve(dictGet(namesRoot, "EmbeddedFiles"))) : undefined);
  const rootAfArr = rootDict ? asArray(doc.cos.resolve(dictGet(rootDict, "AF"))) : undefined;
  if (rootAfArr) {
    for (const item of rootAfArr.items) {
      pushFilespec(asDict(doc.cos.resolve(item)), "");
    }
  }
  for (const p of doc.getPages()) {
    const annotsArr = asArray(doc.cos.resolve(dictGet(p.dict, "Annots")));
    if (!annotsArr) continue;
    for (const item of annotsArr.items) {
      const aDict = asDict(doc.cos.resolve(item));
      if (!aDict) continue;
      if (asName(dictGet(aDict, "Subtype"))?.decoded === "FileAttachment") {
        pushFilespec(asDict(doc.cos.resolve(dictGet(aDict, "FS"))), "");
      }
    }
  }
  return entries;
}

function collectNumberTreeDicts(
  doc: PdfDocument,
  treeDict: PdfCosDict | undefined,
  visited = new Set<number>()
): { index: number; dict: PdfCosDict }[] {
  const out: { index: number; dict: PdfCosDict }[] = [];
  if (!treeDict) return out;
  const numsArr = asArray(doc.cos.resolve(dictGet(treeDict, "Nums")));
  if (numsArr) {
    for (let idx = 0; idx + 1 < numsArr.items.length; idx += 2) {
      const kNode = doc.cos.resolve(numsArr.items[idx]);
      const vDict = asDict(doc.cos.resolve(numsArr.items[idx + 1]));
      if (kNode?.kind === "number" && vDict) {
        out.push({ index: kNode.value, dict: vDict });
      }
    }
  }
  const kidsArr = asArray(doc.cos.resolve(dictGet(treeDict, "Kids")));
  if (kidsArr) {
    for (const kid of kidsArr.items) {
      if (kid.kind === "ref") {
        if (visited.has(kid.objectNumber)) continue;
        visited.add(kid.objectNumber);
      }
      out.push(...collectNumberTreeDicts(doc, asDict(doc.cos.resolve(kid)), visited));
    }
  }
  return out;
}

export async function runQpdfCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>,
  readStdin?: () => Promise<void>
): Promise<QpdfCliResult> {
  let check = false;
  let showNpages = false;
  let showPages = false;
  let withImages = false;
  let showEncryption = false;
  let isEncrypted = false;
  let requiresPassword = false;
  let showXref = false;
  let showObject: { objNum: number; genNum: number } | undefined;
  let filteredStreamData = false;
  let rawStreamData = false;
  let listAttachments = false;
  let showAttachmentKey: string | undefined;
  let jsonVersion: number | undefined;
  const jsonKeys: string[] = [];
  const jsonObjectSelectors: Array<{ kind: "trailer" } | { kind: "obj"; objNum: number; genNum: number }> = [];
  let jsonStreamDataMode: "none" | "inline" | "file" = "none";
  let jsonStreamPrefix: string | undefined;
  let jsonInput = false;
  const updateFromJsonFiles: string[] = [];
  let removeInfo = false;
  let removeMetadata = false;
  let removeStructure = false;
  let removeAcroform = false;
  let emptyInput = false;
  let replaceInput = false;
  let qdf = false;
  let generateAppearances = false;
  let normalizeContentFlag: boolean | undefined;
  let objectStreamsMode: "preserve" | "disable" | "generate" = "preserve";
  let streamDataMode: "uncompress" | "compress" | "preserve" = "preserve";
  let decrypt = false;
  let password: string | undefined;
  let splitPagesGroup: number | undefined;
  let collateCount: number | undefined;
  let linearize = false;
  let showLinearization = false;
  let flattenAnnotations: false | "all" | "print" | "screen" = false;
  let flattenRotation = false;
  let removeUnreferencedResources: "no" | "yes" | "auto" = "no";
  let externalizeInlineImages = false;
  let iiMinBytes = 1024;
  let removePageLabels = false;
  const pageLabelSpecs: string[] = [];
  const removeAttachmentKeys: string[] = [];
  const addAttachmentSpecs: AddAttachmentSpec[] = [];
  const copyAttachmentsSpecs: CopyAttachmentsSpec[] = [];
  const pageSpecs: PageSelectionSpec[] = [];
  const rotateSpecs: RotateSpec[] = [];
  const stampSpecs: StampSpec[] = [];
  let encryptConfig: EncryptConfig | undefined;
  let warningExit0 = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      return {
        exitCode: 0,
        stdout: "Usage: qpdf [options] infile [outfile]\n",
        stderr: ""
      };
    }
    if (arg === "--version") {
      return {
        exitCode: 0,
        stdout: "qpdf version 11.9.1 (@poe-code/pdf-ast)\n",
        stderr: ""
      };
    }
    if (arg === "--check") {
      check = true;
    } else if (arg === "--show-npages" || arg === "--npages") {
      showNpages = true;
    } else if (arg === "--show-pages") {
      showPages = true;
    } else if (arg === "--with-images") {
      withImages = true;
    } else if (arg === "--linearize") {
      linearize = true;
    } else if (arg === "--show-linearization" || arg === "--check-linearization") {
      showLinearization = true;
    } else if (arg === "--collate") {
      collateCount = 1;
    } else if (arg.startsWith("--collate=")) {
      collateCount = Math.max(1, Number.parseInt(arg.slice("--collate=".length), 10) || 1);
    } else if (arg === "--flatten-rotation") {
      flattenRotation = true;
    } else if (arg === "--remove-unreferenced-resources") {
      removeUnreferencedResources = "yes";
    } else if (arg.startsWith("--remove-unreferenced-resources=")) {
      const mode = arg.slice("--remove-unreferenced-resources=".length);
      if (mode === "yes" || mode === "auto" || mode === "no") {
        removeUnreferencedResources = mode;
      } else {
        return { exitCode: 2, stdout: "", stderr: `qpdf: invalid remove-unreferenced-resources mode ${mode}\n` };
      }
    } else if (arg === "--externalize-inline-images") {
      externalizeInlineImages = true;
    } else if (arg.startsWith("--ii-min-bytes=")) {
      const parsed = Number.parseInt(arg.slice("--ii-min-bytes=".length), 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        iiMinBytes = parsed;
      }
    } else if (arg === "--flatten-annotations") {
      flattenAnnotations = "all";
    } else if (arg.startsWith("--flatten-annotations=")) {
      const m = arg.slice("--flatten-annotations=".length);
      flattenAnnotations = m === "print" || m === "screen" ? m : "all";
    } else if (
      arg === "--overlay" ||
      arg === "--underlay" ||
      arg.startsWith("--overlay=") ||
      arg.startsWith("--underlay=")
    ) {
      const isOverlay = arg.startsWith("--overlay");
      let stampFile = "";
      if (arg.includes("=")) {
        stampFile = arg.slice(arg.indexOf("=") + 1);
      } else if (i + 1 < argv.length) {
        stampFile = argv[++i]!;
      }
      const spec: StampSpec = {
        mode: isOverlay ? "overlay" : "underlay",
        file: stampFile,
        fromRange: "1-z",
        toRange: "1-z"
      };
      while (i + 1 < argv.length && argv[i + 1] !== "--") {
        const sub = argv[++i]!;
        if (sub.startsWith("--from=")) spec.fromRange = sub.slice("--from=".length);
        else if (sub.startsWith("--to=")) spec.toRange = sub.slice("--to=".length);
        else if (sub.startsWith("--repeat=")) spec.repeatRange = sub.slice("--repeat=".length);
        else if (sub.startsWith("--password=")) spec.password = sub.slice("--password=".length);
      }
      if (i + 1 < argv.length && argv[i + 1] === "--") {
        i++;
      }
      stampSpecs.push(spec);
    } else if (arg === "--show-encryption") {
      showEncryption = true;
    } else if (arg === "--is-encrypted") {
      isEncrypted = true;
    } else if (arg === "--requires-password") {
      requiresPassword = true;
    } else if (arg === "--show-xref") {
      showXref = true;
    } else if (arg.startsWith("--show-object=")) {
      const val = arg.slice("--show-object=".length);
      const [oStr, gStr] = val.split(",");
      showObject = {
        objNum: Number.parseInt(oStr ?? "1", 10),
        genNum: Number.parseInt(gStr ?? "0", 10)
      };
    } else if (arg === "--filtered-stream-data") {
      filteredStreamData = true;
    } else if (arg === "--raw-stream-data") {
      rawStreamData = true;
    } else if (arg === "--list-attachments") {
      listAttachments = true;
    } else if (arg.startsWith("--show-attachment=")) {
      showAttachmentKey = arg.slice("--show-attachment=".length);
    } else if (arg.startsWith("--remove-attachment=")) {
      removeAttachmentKeys.push(arg.slice("--remove-attachment=".length));
    } else if (arg === "--add-attachment" || arg.startsWith("--add-attachment=")) {
      const attFile = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : (argv[++i] ?? "");
      const baseName = attFile.slice(attFile.lastIndexOf("/") + 1) || "attachment";
      const spec: AddAttachmentSpec = {
        file: attFile,
        key: baseName,
        filename: baseName
      };
      while (i + 1 < argv.length && argv[i + 1] !== "--") {
        const sub = argv[++i]!;
        if (sub.startsWith("--key=")) {
          const k = sub.slice("--key=".length);
          spec.key = k.length > 0 ? k : baseName;
        }
        else if (sub.startsWith("--filename=")) spec.filename = sub.slice("--filename=".length);
        else if (sub.startsWith("--description=")) spec.description = sub.slice("--description=".length);
        else if (sub === "--replace") spec.replace = true;
      }
      if (i + 1 < argv.length && argv[i + 1] === "--") i++;
      addAttachmentSpecs.push(spec);
    } else if (arg === "--copy-attachments-from" || arg.startsWith("--copy-attachments-from=")) {
      const srcFile = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : (argv[++i] ?? "");
      const spec: CopyAttachmentsSpec = { file: srcFile, prefix: "" };
      while (i + 1 < argv.length && argv[i + 1] !== "--") {
        const sub = argv[++i]!;
        if (sub.startsWith("--prefix=")) spec.prefix = sub.slice("--prefix=".length);
        else if (sub.startsWith("--password=")) spec.password = sub.slice("--password=".length);
      }
      if (i + 1 < argv.length && argv[i + 1] === "--") i++;
      copyAttachmentsSpecs.push(spec);
    } else if (arg === "--remove-info") {
      removeInfo = true;
    } else if (arg === "--remove-metadata") {
      removeMetadata = true;
    } else if (arg === "--remove-structure") {
      removeStructure = true;
    } else if (arg === "--remove-acroform") {
      removeAcroform = true;
    } else if (arg === "--remove-page-labels") {
      removePageLabels = true;
    } else if (arg === "--set-page-labels") {
      while (i + 1 < argv.length && argv[i + 1] !== "--") {
        pageLabelSpecs.push(argv[++i]!);
      }
      if (i + 1 < argv.length && argv[i + 1] === "--") i++;
    } else if (arg === "--json") {
      jsonVersion = 2;
    } else if (arg.startsWith("--json=")) {
      const vRaw = arg.slice("--json=".length);
      if (vRaw === "latest" || vRaw === "2") {
        jsonVersion = 2;
      } else if (vRaw === "1") {
        jsonVersion = 1;
      } else {
        return { exitCode: 2, stdout: "", stderr: `qpdf: invalid json version ${vRaw}\n` };
      }
    } else if (arg.startsWith("--json-key=")) {
      const k = arg.slice("--json-key=".length);
      const validKeys = new Set([
        "qpdf",
        "objects",
        "objectinfo",
        "pages",
        "pagelabels",
        "outlines",
        "acroform",
        "attachments",
        "encrypt"
      ]);
      if (!validKeys.has(k)) {
        return { exitCode: 2, stdout: "", stderr: `qpdf: invalid json-key ${k}\n` };
      }
      jsonKeys.push(k);
    } else if (arg.startsWith("--json-object=")) {
      const parsed = parseStrictJsonObjectSelector(arg.slice("--json-object=".length));
      if (!parsed) {
        return { exitCode: 2, stdout: "", stderr: `qpdf: invalid json-object selector\n` };
      }
      jsonObjectSelectors.push(parsed);
    } else if (arg.startsWith("--json-stream-data=")) {
      const m = arg.slice("--json-stream-data=".length);
      if (m === "none" || m === "inline" || m === "file") {
        jsonStreamDataMode = m;
      } else {
        return { exitCode: 2, stdout: "", stderr: `qpdf: invalid json-stream-data mode ${m}\n` };
      }
    } else if (arg.startsWith("--json-stream-prefix=")) {
      jsonStreamPrefix = arg.slice("--json-stream-prefix=".length);
    } else if (arg === "--json-input") {
      jsonInput = true;
    } else if (arg.startsWith("--update-from-json=")) {
      updateFromJsonFiles.push(arg.slice("--update-from-json=".length));
    } else if (arg === "--empty") {
      emptyInput = true;
    } else if (arg === "--replace-input") {
      replaceInput = true;
    } else if (arg === "--qdf") {
      qdf = true;
      streamDataMode = "uncompress";
    } else if (arg === "--generate-appearances") {
      generateAppearances = true;
    } else if (arg.startsWith("--normalize-content=")) {
      const v = arg.slice("--normalize-content=".length);
      if (v === "y") normalizeContentFlag = true;
      else if (v === "n") normalizeContentFlag = false;
      else return { exitCode: 2, stdout: "", stderr: `qpdf: invalid normalize-content value ${v}\n` };
    } else if (arg.startsWith("--compress-streams=")) {
      const v = arg.slice("--compress-streams=".length);
      if (v === "y") streamDataMode = "compress";
      else if (v === "n") streamDataMode = "uncompress";
      else return { exitCode: 2, stdout: "", stderr: `qpdf: invalid compress-streams value ${v}\n` };
    } else if (arg.startsWith("--object-streams=")) {
      const v = arg.slice("--object-streams=".length);
      if (v !== "preserve" && v !== "disable" && v !== "generate") {
        return { exitCode: 2, stdout: "", stderr: `qpdf: invalid object-streams mode ${v}\n` };
      }
      objectStreamsMode = v;
    } else if (arg.startsWith("--stream-data=")) {
      const m = arg.slice("--stream-data=".length);
      if (m === "uncompress" || m === "compress" || m === "preserve") {
        streamDataMode = m;
      }
    } else if (arg === "--decrypt") {
      decrypt = true;
    } else if (arg === "--warning-exit-0") {
      warningExit0 = true;
    } else if (arg.startsWith("--password=")) {
      password = arg.slice("--password=".length);
    } else if (arg === "--split-pages") {
      splitPagesGroup = 1;
    } else if (arg.startsWith("--split-pages=")) {
      splitPagesGroup = Math.max(1, Number.parseInt(arg.slice("--split-pages=".length), 10) || 1);
    } else if (arg.startsWith("--rotate=")) {
      const spec = arg.slice("--rotate=".length);
      const firstColon = spec.indexOf(":");
      const rawAngle = firstColon === -1 ? spec : spec.slice(0, firstColon);
      const rangePart = firstColon === -1 ? "1-z" : spec.slice(firstColon + 1);
      const relative = rawAngle.startsWith("+") || rawAngle.startsWith("-");
      const sign: 1 | -1 = rawAngle.startsWith("-") ? -1 : 1;
      const absDeg = ((Math.abs(Number.parseInt(rawAngle, 10)) % 360) as 0 | 90 | 180 | 270);
      rotateSpecs.push({
        angle: absDeg,
        relative,
        sign,
        range: rangePart || "1-z"
      });
    } else if (arg === "--pages") {
      i++;
      while (i < argv.length && argv[i] !== "--") {
        const fileToken = argv[i]!;
        let filePw: string | undefined;
        let rangeToken = "1-z";
        if (i + 1 < argv.length && argv[i + 1]!.startsWith("--password=")) {
          filePw = argv[++i]!.slice("--password=".length);
        }
        if (
          i + 1 < argv.length &&
          argv[i + 1] !== "--" &&
          !argv[i + 1]!.endsWith(".pdf") &&
          argv[i + 1] !== "."
        ) {
          rangeToken = argv[++i]!;
        }
        pageSpecs.push({
          file: fileToken,
          ...(filePw !== undefined ? { password: filePw } : {}),
          range: rangeToken
        });
        i++;
      }
    } else if (arg === "--encrypt") {
      const userPassword = argv[++i] ?? "";
      const ownerPassword = argv[++i] ?? "";
      const keyLength = Number.parseInt(argv[++i] ?? "256", 10) || 256;
      const cfg: EncryptConfig = {
        userPassword,
        ownerPassword,
        keyLength,
        print: true,
        modify: true,
        copy: true,
        addNotes: true
      };
      i++;
      while (i < argv.length && argv[i] !== "--") {
        const sub = argv[i]!;
        if (sub === "--print=none") cfg.print = false;
        if (sub === "--modify=none") cfg.modify = false;
        if (sub === "--extract=n") cfg.copy = false;
        if (sub === "--annotate=n") cfg.addNotes = false;
        i++;
      }
      encryptConfig = cfg;
    } else if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
    }
  }

  const inputFile = emptyInput ? undefined : positional[0];
  const outputFile = emptyInput ? positional[0] : positional[1];

  if (inputFile === "-" && readStdin) await readStdin();

  const loadBytes = (filePath: string): Uint8Array | undefined => {
    if (filePath === "." && inputFile) return files.get(inputFile);
    return files.get(filePath);
  };

  // Handle predicates first
  if (isEncrypted || requiresPassword) {
    if (!inputFile) {
      return { exitCode: 2, stdout: "", stderr: "qpdf: an input file is required\n" };
    }
    const raw = loadBytes(inputFile);
    if (!raw) {
      return { exitCode: 2, stdout: "", stderr: `qpdf: cannot open ${inputFile}\n` };
    }
    // Check if /Encrypt exists in trailer without password first
    const hasEncryptRef = new TextDecoder("latin1").decode(raw).includes("/Encrypt");
    if (isEncrypted) {
      return { exitCode: hasEncryptRef ? 0 : 2, stdout: "", stderr: "" };
    }
    if (!hasEncryptRef) {
      return { exitCode: 2, stdout: "", stderr: "" };
    }
    if (password === undefined) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    try {
      parseCosDocument(raw, { password });
      return { exitCode: 3, stdout: "", stderr: "" };
    } catch {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  }

  let baseDoc: PdfDocument;
  let repairedWarning = false;

  if (emptyInput) {
    baseDoc = PdfDocument.create();
  } else {
    if (!inputFile) {
      return { exitCode: 2, stdout: "", stderr: "qpdf: an input file is required\n" };
    }
    const raw = loadBytes(inputFile);
    if (!raw) {
      return { exitCode: 2, stdout: "", stderr: `qpdf: cannot open ${inputFile}\n` };
    }
    if (jsonInput) {
      try {
        const parsedJson = JSON.parse(new TextDecoder().decode(raw));
        const objectsMap = new Map<number, { objectNumber: number; generationNumber: number; value: PdfCosNode }>();
        const { rootRef, infoRef } = applyQpdfJsonObjects(objectsMap, parsedJson, files);
        if (!rootRef) {
          return { exitCode: 2, stdout: "", stderr: `qpdf: ${inputFile}: missing trailer /Root\n` };
        }
        const rebuiltBytes = serializeCosDocument({
          objects: [...objectsMap.values()],
          rootRef,
          infoRef,
        });
        baseDoc = PdfDocument.load(rebuiltBytes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { exitCode: 2, stdout: "", stderr: `qpdf: ${inputFile}: ${msg}\n` };
      }
    } else {
      try {
        baseDoc = PdfDocument.load(raw, password !== undefined ? { password } : {});
      } catch {
        try {
          baseDoc = PdfDocument.load(raw, {
            ...(password !== undefined ? { password } : {}),
            recovery: "repair"
          });
          repairedWarning = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { exitCode: 2, stdout: "", stderr: `qpdf: ${inputFile}: ${msg}\n` };
        }
      }
    }
  }

  if (updateFromJsonFiles.length > 0) {
    for (const jsonPath of updateFromJsonFiles) {
      const jsonRaw = loadBytes(jsonPath);
      if (!jsonRaw) {
        return { exitCode: 2, stdout: "", stderr: `qpdf: cannot open ${jsonPath}\n` };
      }
      try {
        const parsedJson = JSON.parse(new TextDecoder().decode(jsonRaw));
        const { rootRef, infoRef } = applyQpdfJsonObjects(baseDoc.cos.objects, parsedJson, files);
        if (rootRef) baseDoc.cos.rootRef = rootRef;
        if (infoRef) baseDoc.cos.infoRef = infoRef;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { exitCode: 2, stdout: "", stderr: `qpdf: ${jsonPath}: ${msg}\n` };
      }
    }
    const updatedBytes = serializeCosDocument({
      objects: [...baseDoc.cos.objects.values()],
      rootRef: baseDoc.cos.rootRef,
      infoRef: baseDoc.cos.infoRef,
    });
    baseDoc = PdfDocument.load(updatedBytes);
  }

  // Inspection modes
  if (showLinearization) {
    const cos = baseDoc.cos;
    let linDict: PdfCosDict | undefined;
    for (const obj of cos.objects.values()) {
      const d = asDict(obj.value);
      if (d && dictGet(d, "Linearized") !== undefined) {
        linDict = d;
        break;
      }
    }
    if (!linDict) {
      return { exitCode: 0, stdout: `${inputFile ?? "empty"}: not linearized\n`, stderr: "" };
    }
    const numVal = (k: string, fb = 0) => {
      const n = cos.resolve(dictGet(linDict!, k));
      return n?.kind === "number" ? n.value : fb;
    };
    const hArr = cos.resolveArray(dictGet(linDict, "H"));
    const h0 = hArr && hArr.items[0] ? (cos.resolve(hArr.items[0]) as any)?.value ?? 0 : 0;
    const h1 = hArr && hArr.items[1] ? (cos.resolve(hArr.items[1]) as any)?.value ?? 0 : 0;
    const out = [
      `${inputFile ?? "empty"}: linearized`,
      `Linearization dictionary: L=${numVal("L")} H=[${h0} ${h1}] O=${numVal("O")} E=${numVal("E")} N=${numVal("N", baseDoc.getPageCount())} T=${numVal("T")}`,
      `no linearization errors`,
    ].join("\n") + "\n";
    return { exitCode: 0, stdout: out, stderr: "" };
  }

  if (check) {
    const cos = baseDoc.cos;
    let isLin = false;
    for (const obj of cos.objects.values()) {
      const d = asDict(obj.value);
      if (d && dictGet(d, "Linearized") !== undefined) {
        isLin = true;
        break;
      }
    }
    const linStatus = baseDoc.getPageCount() === 0 ? "empty" : isLin ? "linearized" : "not linearized";
    const out = `checking ${inputFile ?? "empty"}\nPDF Version: ${cos.version}\nFile is ${cos.encryption ? "encrypted" : "not encrypted"}\nFile is ${linStatus}\nNo syntax or stream encoding errors found; the file may still contain\nerrors that qpdf cannot detect\n`;
    const code = repairedWarning && !warningExit0 ? 3 : 0;
    return { exitCode: code, stdout: out, stderr: "" };
  }

  if (showPages) {
    const lines: string[] = [];
    const pages = baseDoc.getPages();
    const collectImagesFromResources = (
      resDict: PdfCosDict | undefined,
      visitedForms = new Set<number>()
    ) => {
      if (!resDict) return;
      const xobjDict = asDict(baseDoc.cos.resolve(dictGet(resDict, "XObject")));
      if (!xobjDict) return;
      for (const entry of xobjDict.entries) {
        const ref = asRef(entry.value);
        const resolved = baseDoc.cos.resolve(entry.value);
        const streamDict = resolved?.kind === "stream" ? resolved.dict : asDict(resolved);
        const subtype = streamDict ? asName(dictGet(streamDict, "Subtype"))?.decoded : undefined;
        if (subtype === "Image") {
          const w = asNumber(dictGet(streamDict!, "Width"))?.value ?? 0;
          const h = asNumber(dictGet(streamDict!, "Height"))?.value ?? 0;
          const refStr = ref ? `${ref.objectNumber} ${ref.generationNumber} R` : "inline";
          lines.push(`    /${entry.key.decoded}: ${refStr} (${w} x ${h})`);
        } else if (subtype === "Form" && streamDict) {
          if (ref && visitedForms.has(ref.objectNumber)) continue;
          if (ref) visitedForms.add(ref.objectNumber);
          const formRes = asDict(baseDoc.cos.resolve(dictGet(streamDict, "Resources")));
          collectImagesFromResources(formRes, visitedForms);
        }
      }
    };
    for (let idx = 0; idx < pages.length; idx++) {
      const p = pages[idx]!;
      lines.push(`page ${idx + 1}: ${p.ref.objectNumber} ${p.ref.generationNumber} R`);
      if (withImages) {
        lines.push("  images:");
        collectImagesFromResources(p.getResourcesDict());
      }
      lines.push("  content:");
      const contentsNode = dictGet(p.dict, "Contents");
      if (contentsNode?.kind === "ref") {
        lines.push(`    ${contentsNode.objectNumber} ${contentsNode.generationNumber} R`);
      } else if (contentsNode?.kind === "array") {
        for (const item of contentsNode.items) {
          if (item.kind === "ref") {
            lines.push(`    ${item.objectNumber} ${item.generationNumber} R`);
          }
        }
      }
    }
    return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  if (showNpages) {
    return { exitCode: 0, stdout: `${baseDoc.getPageCount()}\n`, stderr: "" };
  }

  if (showEncryption) {
    const enc = baseDoc.cos.encryption;
    if (!enc) {
      return { exitCode: 0, stdout: "File is not encrypted\n", stderr: "" };
    }
    const out = `R = ${enc.revision}\nV = ${enc.version}\nLength = ${enc.keyLengthBits}\nprint: ${enc.permissions.print ? "allowed" : "not allowed"}\nmodify: ${enc.permissions.modify ? "allowed" : "not allowed"}\nextract for accessibility: ${enc.permissions.copy ? "allowed" : "not allowed"}\n`;
    return { exitCode: 0, stdout: out, stderr: "" };
  }

  if (showXref) {
    const lines: string[] = [];
    const revEntries = baseDoc.cos.revisions[0]?.entries;
    for (const [objNum, obj] of [...baseDoc.cos.objects.entries()].sort((a, b) => a[0] - b[0])) {
      const xEntry = revEntries?.get(objNum);
      if (xEntry?.type === "compressed") {
        lines.push(
          `${objNum}/0: compressed; stream = ${xEntry.objectStreamNumber}; index = ${xEntry.indexInObjectStream}; type = ${obj.value.kind}`
        );
      } else {
        lines.push(`${objNum}/${obj.generationNumber}: uncompressed; type = ${obj.value.kind}`);
      }
    }
    return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  if (showObject) {
    const node = baseDoc.cos.getObject(showObject.objNum);
    if (node?.kind === "stream" && (filteredStreamData || rawStreamData)) {
      const bytes = filteredStreamData ? baseDoc.cos.decodeStream(node) : node.rawBytes;
      return { exitCode: 0, stdout: bytesToLatin1(bytes), stderr: "" };
    }
    return { exitCode: 0, stdout: formatCosNodeForDisplay(node) + "\n", stderr: "" };
  }

  if (listAttachments || showAttachmentKey !== undefined) {
    const entries = collectDocumentAttachments(baseDoc);

    if (showAttachmentKey !== undefined) {
      const found = entries.find((e) => e.key === showAttachmentKey || e.filename === showAttachmentKey);
      if (!found) {
        return { exitCode: 2, stdout: "", stderr: `qpdf: attachment ${showAttachmentKey} not found\n` };
      }
      return { exitCode: 0, stdout: bytesToLatin1(found.data), stderr: "" };
    }
    const outLines = entries.map((e) => `${e.key} -> ${e.filename}`);
    return { exitCode: 0, stdout: outLines.length > 0 ? outLines.join("\n") + "\n" : "", stderr: "" };
  }

  if (jsonVersion !== undefined) {
    for (const k of jsonKeys) {
      if (jsonVersion === 1 && k === "qpdf") {
        return { exitCode: 2, stdout: "", stderr: "qpdf: json-key=qpdf is not valid for json=1\n" };
      }
      if (jsonVersion === 2 && (k === "objects" || k === "objectinfo")) {
        return { exitCode: 2, stdout: "", stderr: `qpdf: json-key=${k} is only valid for json=1\n` };
      }
    }
    const effectiveStreamPrefix =
      jsonStreamPrefix ?? (outputFile && outputFile !== "-" ? `${outputFile}-` : undefined);
    if (jsonStreamDataMode === "file" && !effectiveStreamPrefix) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: "qpdf: --json-stream-data=file requires --json-stream-prefix or an output file\n"
      };
    }
    const objectsMap: Record<string, unknown> = {};
    const hasSelector = jsonObjectSelectors.length > 0;
    const matchesSelector = (objNum: number, genNum: number) =>
      !hasSelector ||
      jsonObjectSelectors.some((s) => s.kind === "obj" && s.objNum === objNum && s.genNum === genNum);
    for (const [objNum, obj] of baseDoc.cos.objects.entries()) {
      if (!matchesSelector(objNum, obj.generationNumber)) continue;
      if (obj.value.kind === "stream") {
        const streamObj: Record<string, unknown> = {
          dict: cosNodeToJson(obj.value.dict)
        };
        if (jsonStreamDataMode === "inline") {
          streamObj.data = encodeBytesBase64(baseDoc.cos.decodeStream(obj.value));
        } else if (jsonStreamDataMode === "file" && effectiveStreamPrefix) {
          const streamFile = `${effectiveStreamPrefix}${objNum}`;
          const decoded = baseDoc.cos.decodeStream(obj.value);
          files.set(streamFile, decoded);
          streamObj.datafile = streamFile;
        }
        objectsMap[`obj:${objNum} ${obj.generationNumber} R`] = { stream: streamObj };
      } else {
        objectsMap[`obj:${objNum} ${obj.generationNumber} R`] = {
          value: cosNodeToJson(obj.value)
        };
      }
    }
    if (!hasSelector || jsonObjectSelectors.some((s) => s.kind === "trailer")) {
      const trailerDict = cosDict({
        Root: baseDoc.cos.rootRef,
        ...(baseDoc.cos.infoRef ? { Info: baseDoc.cos.infoRef } : {}),
        Size: cosNumber(baseDoc.cos.maxObjectNumber + 1)
      });
      objectsMap.trailer = {
        value: cosNodeToJson(trailerDict)
      };
    }
    const attachmentsJson: Record<string, unknown> = {};
    const rootDictForJson = asDict(baseDoc.cos.resolve(baseDoc.cos.rootRef));
    for (const att of collectDocumentAttachments(baseDoc)) {
      attachmentsJson[att.key] = { filename: att.filename };
    }
    const acroDictJson = rootDictForJson ? asDict(baseDoc.cos.resolve(dictGet(rootDictForJson, "AcroForm"))) : undefined;
    const needAppJson = acroDictJson ? baseDoc.cos.resolve(dictGet(acroDictJson, "NeedAppearances")) : undefined;
    const acroFieldsJson = baseDoc.getFormFields().map(f => ({
      name: f.name,
      type: f.type,
      value: f.value
    }));
    const acroformSection = {
      hasacroform: Boolean(acroDictJson && acroFieldsJson.length > 0),
      needappearances: needAppJson?.kind === "boolean" ? needAppJson.value : false,
      fields: acroFieldsJson
    };
    const outlinesJson: Array<{ title: string; destpagepos: number; destpageobject: string }> = [];
    const outlinesRootJson = rootDictForJson ? asDict(baseDoc.cos.resolve(dictGet(rootDictForJson, "Outlines"))) : undefined;
    const collectJsonOutlines = (nodeOrRef: PdfCosNode | undefined, visited = new Set<number>()) => {
      let cur = nodeOrRef;
      while (cur) {
        if (cur.kind === "ref") {
          if (visited.has(cur.objectNumber)) break;
          visited.add(cur.objectNumber);
        }
        const d = asDict(baseDoc.cos.resolve(cur));
        if (!d) break;
        const tNode = baseDoc.cos.resolve(dictGet(d, "Title"));
        const title = tNode?.kind === "string" ? decodePdfString(tNode) : "";
        const destPageIdx =
          resolveDestinationPageIndex(baseDoc, dictGet(d, "Dest") ?? dictGet(d, "A")) ?? 0;
        const pageRef = baseDoc.getPageCount() > 0 ? baseDoc.getPage(destPageIdx).ref : { objectNumber: 0, generationNumber: 0 };
        if (title) {
          outlinesJson.push({
            title,
            destpagepos: destPageIdx + 1,
            destpageobject: `obj:${pageRef.objectNumber} ${pageRef.generationNumber} R`
          });
        }
        const firstChild = dictGet(d, "First");
        if (firstChild) collectJsonOutlines(firstChild, visited);
        cur = dictGet(d, "Next");
      }
    };
    if (outlinesRootJson) collectJsonOutlines(dictGet(outlinesRootJson, "First"));

    const pagelabelsJson: Array<{ index: number; start: number; prefix?: string; style?: string }> = [];
    const plTreeJson = rootDictForJson ? asDict(baseDoc.cos.resolve(dictGet(rootDictForJson, "PageLabels"))) : undefined;
    for (const { index: plIdx, dict: vDict } of collectNumberTreeDicts(baseDoc, plTreeJson)) {
      const stNode = baseDoc.cos.resolve(dictGet(vDict, "St"));
      const pNode = baseDoc.cos.resolve(dictGet(vDict, "P"));
      const sNode = baseDoc.cos.resolve(dictGet(vDict, "S"));
      pagelabelsJson.push({
        index: plIdx,
        start: stNode?.kind === "number" ? stNode.value : 1,
        ...(pNode?.kind === "string" ? { prefix: decodePdfString(pNode) } : {}),
        ...(sNode?.kind === "name" ? { style: sNode.decoded } : {})
      });
    }

    const pagesVal = jsonKeys.includes("pages")
      ? baseDoc.getPages().map((pg, idx) => ({
          object: `obj:${pg.ref.objectNumber} ${pg.ref.generationNumber} R`,
          pageposfrom1: idx + 1
        }))
      : baseDoc.getPageCount();

    const payload =
      jsonVersion === 1
        ? {
            version: 1,
            pdfversion: baseDoc.cos.version,
            pages: pagesVal,
            pagelabels: pagelabelsJson,
            outlines: outlinesJson,
            acroform: acroformSection,
            encrypt: { encrypted: Boolean(baseDoc.cos.encryption) },
            attachments: attachmentsJson,
            objects: objectsMap
          }
        : {
            version: 2,
            qpdf: [
              {
                pdfversion: baseDoc.cos.version,
                maxobjectid: baseDoc.cos.maxObjectNumber,
                pages: pagesVal,
                pagelabels: pagelabelsJson,
                outlines: outlinesJson,
                acroform: acroformSection,
                encrypt: { encrypted: Boolean(baseDoc.cos.encryption) },
                attachments: attachmentsJson
              },
              objectsMap
            ]
          };
    const jsonOut = JSON.stringify(payload, null, 2) + "\n";
    if (outputFile && outputFile !== "-") {
      files.set(outputFile, new TextEncoder().encode(jsonOut));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: jsonOut, stderr: "" };
  }

  // Page selection / merging (--pages ... --)
  let workingDoc = baseDoc;
  if (pageSpecs.length > 0) {
    const mergedDoc = PdfDocument.create();
    const meta = baseDoc.getMetadata();
    if (!emptyInput) {
      if (meta.title) mergedDoc.setTitle(meta.title);
      if (meta.author) mergedDoc.setAuthor(meta.author);
    }
    const loadedSpecs: { doc: PdfDocument; indices: number[] }[] = [];
    for (const spec of pageSpecs) {
      const srcBytes = loadBytes(spec.file);
      if (!srcBytes) {
        return { exitCode: 2, stdout: "", stderr: `qpdf: cannot open ${spec.file}\n` };
      }
      const srcPw = spec.password ?? password;
      const srcDoc = PdfDocument.load(srcBytes, srcPw !== undefined ? { password: srcPw } : {});
      const pageNumbers = parseQpdfPageRange(spec.range, srcDoc.getPageCount());
      loadedSpecs.push({ doc: srcDoc, indices: pageNumbers.map((p) => p - 1) });
    }
    if (collateCount !== undefined && loadedSpecs.length > 1) {
      const cursors = loadedSpecs.map(() => 0);
      let remaining = true;
      while (remaining) {
        remaining = false;
        for (let s = 0; s < loadedSpecs.length; s++) {
          const item = loadedSpecs[s]!;
          const cur = cursors[s]!;
          if (cur < item.indices.length) {
            const slice = item.indices.slice(cur, cur + collateCount);
            mergedDoc.copyPagesFrom(item.doc, slice);
            cursors[s] = cur + slice.length;
            if (cursors[s]! < item.indices.length) remaining = true;
          }
        }
      }
    } else {
      for (const item of loadedSpecs) {
        mergedDoc.copyPagesFrom(item.doc, item.indices);
      }
    }
    workingDoc = mergedDoc;
  }

  // Apply rotations (--rotate=[+|-]angle:range)
  for (const rot of rotateSpecs) {
    const pageNums = parseQpdfPageRange(rot.range, workingDoc.getPageCount());
    for (const pNum of pageNums) {
      const page = workingDoc.getPage(pNum - 1);
      if (rot.relative) {
        const current = page.getRotation();
        const next = (((current + rot.sign * rot.angle) % 360) + 360) % 360;
        if (next === 0 || next === 90 || next === 180 || next === 270) {
          page.setRotation(next);
        }
      } else {
        page.setRotation(rot.angle);
      }
    }
  }

  // Apply --overlay / --underlay
  let stampResCounter = 1;
  for (const stamp of stampSpecs) {
    const stampBytes = loadBytes(stamp.file);
    if (!stampBytes) {
      return { exitCode: 2, stdout: "", stderr: `qpdf: cannot open ${stamp.file}\n` };
    }
    const stampPw = stamp.password ?? password;
    const stampDoc = PdfDocument.load(stampBytes, stampPw !== undefined ? { password: stampPw } : {});
    const fromPages = parseQpdfPageRange(stamp.fromRange, stampDoc.getPageCount());
    const toPages = parseQpdfPageRange(stamp.toRange, workingDoc.getPageCount());
    const repeatPages = stamp.repeatRange
      ? parseQpdfPageRange(stamp.repeatRange, stampDoc.getPageCount())
      : fromPages;

    const cloneMemo = new Map<number, PdfCosRef>();
    const cloneFromStampCos = (node: PdfCosNode): PdfCosNode => {
      if (node.kind === "ref") {
        const existing = cloneMemo.get(node.objectNumber);
        if (existing) return existing;
        const target = stampDoc.cos.getObject(node.objectNumber);
        if (!target) return { kind: "null" };
        const placeholder = workingDoc.cos.allocateObject({ kind: "null" });
        cloneMemo.set(node.objectNumber, placeholder);
        workingDoc.cos.setObject(placeholder.objectNumber, cloneFromStampCos(target), 0);
        return placeholder;
      }
      if (node.kind === "array") {
        return cosArray(node.items.map(cloneFromStampCos));
      }
      if (node.kind === "dict") {
        const entries: PdfDictEntry[] = node.entries
          .filter(e => e.key.decoded !== "Parent")
          .map(e => ({ key: { ...e.key }, value: cloneFromStampCos(e.value) }));
        return { kind: "dict", entries };
      }
      if (node.kind === "stream") {
        return {
          kind: "stream",
          dict: cloneFromStampCos(node.dict) as PdfCosDict,
          rawBytes: new Uint8Array(node.rawBytes),
          decodedBytes: node.decodedBytes ? new Uint8Array(node.decodedBytes) : undefined,
        };
      }
      return node;
    };

    if (fromPages.length > 0 && toPages.length > 0) {
      const enc = new TextEncoder();
      for (let idx = 0; idx < toPages.length; idx++) {
        const targetPageNum = toPages[idx]!;
        let stampPageNum: number;
        if (idx < fromPages.length) {
          stampPageNum = fromPages[idx]!;
        } else if (repeatPages.length > 0) {
          stampPageNum = repeatPages[(idx - fromPages.length) % repeatPages.length]!;
        } else {
          break;
        }
        const targetPage = workingDoc.getPage(targetPageNum - 1);
        const srcStampPage = stampDoc.getPage(stampPageNum - 1);
        const targetStream = targetPage.getRawContentStream();
        let stampStreamStr = bytesToIso88591(srcStampPage.getRawContentStream());

        // Clone and merge Font, XObject, ExtGState from srcStampPage into targetPage
        const targetRes = targetPage.getResourcesDict();
        const srcRes = srcStampPage.getResourcesDict();
        for (const catKey of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties"] as const) {
          const srcSub = asDict(stampDoc.cos.resolve(dictGet(srcRes, catKey)));
          if (!srcSub) continue;
          let dstSub = asDict(workingDoc.cos.resolve(dictGet(targetRes, catKey)));
          if (!dstSub) {
            dstSub = cosDict({});
            dictSet(targetRes, catKey, dstSub);
          }
          for (const entry of srcSub.entries) {
            const origKey = entry.key.decoded;
            let finalKey = origKey;
            if (dictGet(dstSub, origKey)) {
              finalKey = `QStp${stampResCounter++}_${origKey}`;
              stampStreamStr = replacePdfNameToken(stampStreamStr, origKey, finalKey);
            }
            dictSet(dstSub, finalKey, cloneFromStampCos(entry.value));
          }
        }
        const stampStream = iso88591ToBytes(stampStreamStr);

        // Merge stamp stream into target stream wrapped in q ... Q (with MediaBox scaling/centering & rotation alignment)
        const dstSize = targetPage.getSize();
        const srcSize = srcStampPage.getSize();
        const rotDiff = (((targetPage.getRotation() - srcStampPage.getRotation()) % 360) + 360) % 360;
        let stampOpenStr = "q\n";
        if (srcSize.width > 0 && srcSize.height > 0) {
          const fmt6 = (n: number) => Number(n.toFixed(6));
          const fmt4 = (n: number) => Number(n.toFixed(4));
          if (rotDiff === 90) {
            const s = Math.min(dstSize.height / srcSize.width, dstSize.width / srcSize.height);
            const ox = (dstSize.height - srcSize.width * s) / 2;
            const oy = (dstSize.width - srcSize.height * s) / 2;
            stampOpenStr = `q\n0 ${fmt6(s)} ${fmt6(-s)} 0 ${fmt4(dstSize.width - oy)} ${fmt4(ox)} cm\n`;
          } else if (rotDiff === 180) {
            const s = Math.min(dstSize.width / srcSize.width, dstSize.height / srcSize.height);
            const ox = (dstSize.width - srcSize.width * s) / 2;
            const oy = (dstSize.height - srcSize.height * s) / 2;
            stampOpenStr = `q\n${fmt6(-s)} 0 0 ${fmt6(-s)} ${fmt4(dstSize.width - ox)} ${fmt4(dstSize.height - oy)} cm\n`;
          } else if (rotDiff === 270) {
            const s = Math.min(dstSize.height / srcSize.width, dstSize.width / srcSize.height);
            const ox = (dstSize.height - srcSize.width * s) / 2;
            const oy = (dstSize.width - srcSize.height * s) / 2;
            stampOpenStr = `q\n0 ${fmt6(-s)} ${fmt6(s)} 0 ${fmt4(oy)} ${fmt4(dstSize.height - ox)} cm\n`;
          } else if (Math.abs(srcSize.width - dstSize.width) > 0.5 || Math.abs(srcSize.height - dstSize.height) > 0.5) {
            const s = Math.min(dstSize.width / srcSize.width, dstSize.height / srcSize.height);
            const tx = (dstSize.width - srcSize.width * s) / 2;
            const ty = (dstSize.height - srcSize.height * s) / 2;
            stampOpenStr = `q\n${fmt6(s)} 0 0 ${fmt6(s)} ${fmt4(tx)} ${fmt4(ty)} cm\n`;
          }
        }
        const qOpenTarget = enc.encode("q\n");
        const qOpenStamp = enc.encode(stampOpenStr);
        const qClose = enc.encode("\nQ\n");
        const firstOpen = stamp.mode === "underlay" ? qOpenStamp : qOpenTarget;
        const firstPart = stamp.mode === "underlay" ? stampStream : targetStream;
        const secondOpen = stamp.mode === "underlay" ? qOpenTarget : qOpenStamp;
        const secondPart = stamp.mode === "underlay" ? targetStream : stampStream;
        const merged = new Uint8Array(
          firstOpen.length + firstPart.length + qClose.length + secondOpen.length + secondPart.length + qClose.length
        );
        let pos = 0;
        merged.set(firstOpen, pos); pos += firstOpen.length;
        merged.set(firstPart, pos); pos += firstPart.length;
        merged.set(qClose, pos); pos += qClose.length;
        merged.set(secondOpen, pos); pos += secondOpen.length;
        merged.set(secondPart, pos); pos += secondPart.length;
        merged.set(qClose, pos);
        targetPage.setRawContentStream(merged);
      }
    }
  }

  // Apply --flatten-rotation
  if (flattenRotation) {
    const enc = new TextEncoder();
    for (const page of workingDoc.getPages()) {
      const rot = page.getRotation();
      if (rot === 90 || rot === 180 || rot === 270) {
        const { width: W, height: H } = page.getSize();
        const mapPt = (x: number, y: number): [number, number] => {
          if (rot === 90) return [y, W - x];
          if (rot === 180) return [W - x, H - y];
          return [H - y, x];
        };
        const mapRectNode = (arrNode: PdfCosNode | undefined): PdfCosNode | undefined => {
          const arr = asArray(workingDoc.cos.resolve(arrNode));
          if (!arr || arr.items.length < 4) return undefined;
          const nums = arr.items.slice(0, 4).map(it => {
            const r = workingDoc.cos.resolve(it);
            return r?.kind === "number" ? r.value : 0;
          });
          const [p0x, p0y] = mapPt(nums[0]!, nums[1]!);
          const [p1x, p1y] = mapPt(nums[2]!, nums[3]!);
          return cosArray([
            cosNumber(Math.min(p0x, p1x)),
            cosNumber(Math.min(p0y, p1y)),
            cosNumber(Math.max(p0x, p1x)),
            cosNumber(Math.max(p0y, p1y)),
          ]);
        };

        let cmCmd = "";
        if (rot === 90) {
          cmCmd = `q\n0 -1 1 0 0 ${W} cm\n`;
          dictSet(page.dict, "MediaBox", cosArray([cosNumber(0), cosNumber(0), cosNumber(H), cosNumber(W)]));
        } else if (rot === 180) {
          cmCmd = `q\n-1 0 0 -1 ${W} ${H} cm\n`;
        } else if (rot === 270) {
          cmCmd = `q\n0 1 -1 0 ${H} 0 cm\n`;
          dictSet(page.dict, "MediaBox", cosArray([cosNumber(0), cosNumber(0), cosNumber(H), cosNumber(W)]));
        }
        for (const boxKey of ["CropBox", "BleedBox", "TrimBox", "ArtBox"] as const) {
          const mapped = mapRectNode(dictGet(page.dict, boxKey));
          if (mapped) dictSet(page.dict, boxKey, mapped);
        }
        const annotsArr = asArray(workingDoc.cos.resolve(dictGet(page.dict, "Annots")));
        if (annotsArr) {
          for (const item of annotsArr.items) {
            const aDict = asDict(workingDoc.cos.resolve(item));
            if (!aDict) continue;
            const mappedRect = mapRectNode(dictGet(aDict, "Rect"));
            if (mappedRect) dictSet(aDict, "Rect", mappedRect);
          }
        }
        const raw = page.getRawContentStream();
        const pre = enc.encode(cmCmd);
        const post = enc.encode("\nQ\n");
        const combined = new Uint8Array(pre.length + raw.length + post.length);
        combined.set(pre, 0);
        combined.set(raw, pre.length);
        combined.set(post, pre.length + raw.length);
        page.setRawContentStream(combined);
        page.setRotation(0);
      }
    }
  }

  // Apply --flatten-annotations
  if (flattenAnnotations !== false) {
    const enc = new TextEncoder();
    for (const page of workingDoc.getPages()) {
      const annotsNode = workingDoc.cos.resolve(dictGet(page.dict, "Annots"));
      const annotsArr = asArray(annotsNode);
      if (!annotsArr) continue;
      const survivingAnnots: PdfCosNode[] = [];
      for (const item of annotsArr.items) {
        const annotDict = asDict(workingDoc.cos.resolve(item));
        if (!annotDict) continue;
        const subtype = asName(dictGet(annotDict, "Subtype"))?.decoded;
        if (subtype === "Link" || subtype === "Popup") {
          survivingAnnots.push(item);
          continue;
        }
        const flagsNode = asNumber(workingDoc.cos.resolve(dictGet(annotDict, "F")));
        if (flagsNode !== undefined) {
          const flags = flagsNode.value;
          const isInvisibleOrHidden = (flags & 1) !== 0 || (flags & 2) !== 0;
          if (isInvisibleOrHidden) continue;
          if (flattenAnnotations === "print" && (flags & 4) === 0) {
            continue;
          }
          if (flattenAnnotations === "screen" && (flags & 32) !== 0) {
            continue;
          }
        }
        const rectArr = asArray(workingDoc.cos.resolve(dictGet(annotDict, "Rect")));
        const rx0 = asNumber(workingDoc.cos.resolve(rectArr?.items[0]))?.value ?? 72;
        const ry0 = asNumber(workingDoc.cos.resolve(rectArr?.items[1]))?.value ?? 72;
        const rx1 = asNumber(workingDoc.cos.resolve(rectArr?.items[2]))?.value ?? rx0 + 50;
        const ry1 = asNumber(workingDoc.cos.resolve(rectArr?.items[3]))?.value ?? ry0 + 20;

        // Check for custom /AP << /N ... >> appearance stream
        const apDict = asDict(workingDoc.cos.resolve(dictGet(annotDict, "AP")));
        let apStreamNode = apDict ? workingDoc.cos.resolve(dictGet(apDict, "N")) : undefined;
        if (apStreamNode?.kind === "dict") {
          const asState = asName(workingDoc.cos.resolve(dictGet(annotDict, "AS")))?.decoded;
          apStreamNode =
            (asState ? workingDoc.cos.resolve(dictGet(apStreamNode, asState)) : undefined) ??
            workingDoc.cos.resolve(apStreamNode.entries[0]?.value);
        }
        if (apStreamNode?.kind === "stream") {
          let apBytes = workingDoc.cos.decodeStream(apStreamNode);
          if (apBytes.byteLength > 0) {
            const bboxArr = asArray(workingDoc.cos.resolve(dictGet(apStreamNode.dict, "BBox")));
            const bx0 = asNumber(workingDoc.cos.resolve(bboxArr?.items[0]))?.value ?? 0;
            const by0 = asNumber(workingDoc.cos.resolve(bboxArr?.items[1]))?.value ?? 0;
            const bx1 = asNumber(workingDoc.cos.resolve(bboxArr?.items[2]))?.value ?? Math.max(1, rx1 - rx0);
            const by1 = asNumber(workingDoc.cos.resolve(bboxArr?.items[3]))?.value ?? Math.max(1, ry1 - ry0);
            const matArr = asArray(workingDoc.cos.resolve(dictGet(apStreamNode.dict, "Matrix")));
            let ma = 1, mb = 0, mc = 0, md = 1, me = 0, mf = 0;
            let hasFormMatrix = false;
            if (matArr && matArr.items.length >= 6) {
              const mNums = matArr.items.slice(0, 6).map(it => asNumber(workingDoc.cos.resolve(it))?.value ?? 0);
              ma = mNums[0]!; mb = mNums[1]!; mc = mNums[2]!; md = mNums[3]!; me = mNums[4]!; mf = mNums[5]!;
              hasFormMatrix = true;
            }
            const corners = [
              [bx0 * ma + by0 * mc + me, bx0 * mb + by0 * md + mf],
              [bx1 * ma + by0 * mc + me, bx1 * mb + by0 * md + mf],
              [bx0 * ma + by1 * mc + me, bx0 * mb + by1 * md + mf],
              [bx1 * ma + by1 * mc + me, bx1 * mb + by1 * md + mf],
            ];
            const tbx0 = Math.min(...corners.map(c => c[0]!));
            const tby0 = Math.min(...corners.map(c => c[1]!));
            const tbx1 = Math.max(...corners.map(c => c[0]!));
            const tby1 = Math.max(...corners.map(c => c[1]!));
            const bw = Math.max(1e-6, tbx1 - tbx0);
            const bh = Math.max(1e-6, tby1 - tby0);
            const scaleX = (rx1 - rx0) / bw;
            const scaleY = (ry1 - ry0) / bh;
            const tx = rx0 - tbx0 * scaleX;
            const ty = ry0 - tby0 * scaleY;

            // Merge /AP /N /Resources into page /Resources with collision renaming
            const apRes = asDict(workingDoc.cos.resolve(dictGet(apStreamNode.dict, "Resources")));
            const resRenames = new Map<string, string>();
            if (apRes) {
              const pageRes = page.getResourcesDict();
              for (const catKey of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties"] as const) {
                const srcSub = asDict(workingDoc.cos.resolve(dictGet(apRes, catKey)));
                if (!srcSub) continue;
                let dstSub = asDict(workingDoc.cos.resolve(dictGet(pageRes, catKey)));
                if (!dstSub) {
                  dstSub = cosDict({});
                  dictSet(pageRes, catKey, dstSub);
                }
                for (const entry of srcSub.entries) {
                  const origName = entry.key.decoded;
                  const existingEntry = dictGet(dstSub, origName);
                  if (!existingEntry) {
                    dictSet(dstSub, origName, entry.value);
                  } else if (
                    existingEntry.kind === "ref" &&
                    entry.value.kind === "ref" &&
                    existingEntry.objectNumber === entry.value.objectNumber
                  ) {
                    // Same ref
                  } else {
                    let suffix = 1;
                    while (dictGet(dstSub, `${origName}_qap${suffix}`)) suffix++;
                    const newName = `${origName}_qap${suffix}`;
                    dictSet(dstSub, newName, entry.value);
                    resRenames.set(origName, newName);
                  }
                }
              }
            }
            if (resRenames.size > 0) {
              let text = bytesToIso88591(apBytes);
              for (const [oldKey, newKey] of resRenames.entries()) {
                text = replacePdfNameToken(text, oldKey, newKey);
              }
              apBytes = iso88591ToBytes(text);
            }

            const curContent = page.getRawContentStream();
            const matSuffix = hasFormMatrix ? ` ${ma} ${mb} ${mc} ${md} ${me} ${mf} cm` : "";
            const prefix = enc.encode(`\nq ${scaleX} 0 0 ${scaleY} ${tx} ${ty} cm${matSuffix}\n`);
            const suffix = enc.encode(`\nQ\n`);
            const combined = new Uint8Array(curContent.length + prefix.length + apBytes.length + suffix.length);
            combined.set(curContent, 0);
            combined.set(prefix, curContent.length);
            combined.set(apBytes, curContent.length + prefix.length);
            combined.set(suffix, curContent.length + prefix.length + apBytes.length);
            page.setRawContentStream(combined);
            continue;
          }
        }

        const contentsNode = dictGet(annotDict, "Contents");
        let text =
          contentsNode?.kind === "string" ? decodePdfString(contentsNode).trim() : "";
        if (!text) {
          const parentDict = asDict(workingDoc.cos.resolve(dictGet(annotDict, "Parent")));
          const vNode =
            workingDoc.cos.resolve(dictGet(annotDict, "V")) ??
            (parentDict ? workingDoc.cos.resolve(dictGet(parentDict, "V")) : undefined);
          const asStateNode = workingDoc.cos.resolve(dictGet(annotDict, "AS"));
          if (vNode?.kind === "string") {
            text = decodePdfString(vNode).trim();
          } else if (vNode?.kind === "name" && vNode.decoded !== "Off") {
            text = vNode.decoded;
          } else if (asStateNode?.kind === "name" && asStateNode.decoded !== "Off") {
            text = asStateNode.decoded;
          }
        }
        if (text.length > 0) {
          page.drawText(text, { x: rx0, y: ry0, size: 10 });
        }
      }
      if (survivingAnnots.length > 0) {
        dictSet(page.dict, "Annots", cosArray(survivingAnnots));
      } else {
        dictDelete(page.dict, "Annots");
      }
    }
  }

  // Apply --externalize-inline-images
  if (externalizeInlineImages) {
    const keyExpandMap: Record<string, string> = {
      BPC: "BitsPerComponent",
      CS: "ColorSpace",
      D: "Decode",
      DP: "DecodeParms",
      F: "Filter",
      H: "Height",
      IM: "ImageMask",
      I: "Interpolate",
      W: "Width",
    };
    const csExpandMap: Record<string, string> = {
      G: "DeviceGray",
      RGB: "DeviceRGB",
      CMYK: "DeviceCMYK",
      I: "Indexed",
    };
    const filterExpandMap: Record<string, string> = {
      AHx: "ASCIIHexDecode",
      A85: "ASCII85Decode",
      LZW: "LZWDecode",
      Fl: "FlateDecode",
      RL: "RunLengthDecode",
      CCF: "CCITTFaxDecode",
      DCT: "DCTDecode",
    };
    let extCounter = 1;
    for (const page of workingDoc.getPages()) {
      let modified = false;
      const pageRes = page.getResourcesDict();
      let xobjSub = asDict(workingDoc.cos.resolve(dictGet(pageRes, "XObject")));
      const transformNodes = (
        nodes: readonly import("@poe-code/pdf-ast").PdfContentNode[]
      ): import("@poe-code/pdf-ast").PdfContentNode[] => {
        const out: import("@poe-code/pdf-ast").PdfContentNode[] = [];
        for (const node of nodes) {
          if (node.kind === "graphics-group") {
            out.push({ kind: "graphics-group", ops: transformNodes(node.ops) });
          } else if (node.kind === "marked-content") {
            out.push({ ...node, children: transformNodes(node.children) });
          } else if (node.kind === "inline-image" && node.data.byteLength >= iiMinBytes) {
            if (!xobjSub) {
              xobjSub = cosDict({});
              dictSet(pageRes, "XObject", xobjSub);
            }
            let resName = `ImExt${extCounter++}`;
            while (dictGet(xobjSub, resName)) {
              resName = `ImExt${extCounter++}`;
            }
            const imgDict = cosDict({
              Type: cosName("XObject"),
              Subtype: cosName("Image"),
            });
            for (const entry of node.dict.entries) {
              const fullKey = keyExpandMap[entry.key.decoded] ?? entry.key.decoded;
              let val = entry.value;
              if (fullKey === "ColorSpace" && val.kind === "name") {
                val = cosName(csExpandMap[val.decoded] ?? val.decoded);
              } else if (fullKey === "Filter" && val.kind === "name") {
                val = cosName(filterExpandMap[val.decoded] ?? val.decoded);
              }
              dictSet(imgDict, fullKey, val);
            }
            const imgStreamRef = workingDoc.cos.allocateObject(cosStream(imgDict, node.data));
            dictSet(xobjSub, resName, imgStreamRef);
            out.push({ kind: "xobject", name: resName });
            modified = true;
          } else {
            out.push(node);
          }
        }
        return out;
      };
      const nextAst = transformNodes(page.getContentAst());
      if (modified) {
        page.setContentAst(nextAst, streamDataMode !== "uncompress");
      }
    }
  }

  // Apply --remove-unreferenced-resources
  if (removeUnreferencedResources === "yes" || removeUnreferencedResources === "auto") {
    const collectPdfNamesFromBytes = (bytes: Uint8Array, names: Set<string>): void => {
      const str = bytesToIso88591(bytes);
      let idx = 0;
      while (idx < str.length) {
        if (str[idx] === "/") {
          idx++;
          let tok = "";
          while (idx < str.length && !isPdfDelimiterOrSpace(str[idx])) {
            if (str[idx] === "#" && idx + 2 < str.length) {
              const hex = Number.parseInt(str.slice(idx + 1, idx + 3), 16);
              if (Number.isFinite(hex)) {
                tok += String.fromCharCode(hex);
                idx += 3;
                continue;
              }
            }
            tok += str[idx]!;
            idx++;
          }
          if (tok.length > 0) names.add(tok);
        } else {
          idx++;
        }
      }
    };

    const resourceCategories = [
      "Font",
      "XObject",
      "ExtGState",
      "ColorSpace",
      "Pattern",
      "Shading",
      "Properties",
    ] as const;

    for (const page of workingDoc.getPages()) {
      const refNames = new Set<string>();
      collectPdfNamesFromBytes(page.getRawContentStream(), refNames);

      // Also inspect annotation appearance streams on this page
      const annotsArr = asArray(workingDoc.cos.resolve(dictGet(page.dict, "Annots")));
      if (annotsArr) {
        for (const item of annotsArr.items) {
          const aDict = asDict(workingDoc.cos.resolve(item));
          const apDict = aDict ? asDict(workingDoc.cos.resolve(dictGet(aDict, "AP"))) : undefined;
          const apN = apDict ? workingDoc.cos.resolve(dictGet(apDict, "N")) : undefined;
          if (apN?.kind === "stream") {
            collectPdfNamesFromBytes(workingDoc.cos.decodeStream(apN), refNames);
          }
        }
      }

      const pageRes = page.getResourcesDict();
      // Expand transitive references from referenced Form XObjects and Tiling Patterns
      let changed = true;
      const visitedObjs = new Set<string>();
      while (changed) {
        changed = false;
        for (const catKey of ["XObject", "Pattern"] as const) {
          const sub = asDict(workingDoc.cos.resolve(dictGet(pageRes, catKey)));
          if (!sub) continue;
          for (const entry of sub.entries) {
            const visitId = `${catKey}:${entry.key.decoded}`;
            if (refNames.has(entry.key.decoded) && !visitedObjs.has(visitId)) {
              visitedObjs.add(visitId);
              const resolved = workingDoc.cos.resolve(entry.value);
              if (resolved?.kind === "stream") {
                const prevSize = refNames.size;
                collectPdfNamesFromBytes(workingDoc.cos.decodeStream(resolved), refNames);
                if (refNames.size > prevSize) changed = true;
              }
            }
          }
        }
      }

      for (const catKey of resourceCategories) {
        const sub = asDict(workingDoc.cos.resolve(dictGet(pageRes, catKey)));
        if (!sub) continue;
        for (const entry of [...sub.entries]) {
          if (!refNames.has(entry.key.decoded)) {
            dictDelete(sub, entry.key.decoded);
          }
        }
        if (sub.entries.length === 0) {
          dictDelete(pageRes, catKey);
        }
      }
    }
  }

  // Apply --linearize marker object
  if (linearize) {
    const linDict: PdfCosDict = cosDict({
      Linearized: cosNumber(1),
      N: cosNumber(workingDoc.getPageCount())
    });
    workingDoc.cos.allocateObject(linDict);
  }

  // Apply --remove-page-labels and --set-page-labels
  if (removePageLabels || pageLabelSpecs.length > 0) {
    const rootDict = asDict(workingDoc.cos.resolve(workingDoc.cos.rootRef));
    if (rootDict) {
      if (removePageLabels && pageLabelSpecs.length === 0) {
        dictDelete(rootDict, "PageLabels");
      } else if (pageLabelSpecs.length > 0) {
        const numsItems: PdfCosNode[] = [];
        for (const spec of pageLabelSpecs) {
          const colonIdx = spec.indexOf(":");
          if (colonIdx <= 0) continue;
          const startPage = Math.max(1, Number.parseInt(spec.slice(0, colonIdx), 10) || 1);
          const rest = spec.slice(colonIdx + 1).split("/");
          const styleCode = rest[0] ?? "D";
          const parsedSecond = rest[1] !== undefined && rest[1].length > 0 ? Number.parseInt(rest[1], 10) : Number.NaN;
          const startNum = Number.isFinite(parsedSecond) ? parsedSecond || 1 : 1;
          const prefix = rest.length >= 3 ? (rest[2] ?? "") : !Number.isFinite(parsedSecond) ? (rest[1] ?? "") : "";
          const labelDict = cosDict({});
          if (styleCode !== "n") {
            dictSet(labelDict, "S", cosName(styleCode));
          }
          if (startNum !== 1) {
            dictSet(labelDict, "St", cosNumber(startNum));
          }
          if (prefix.length > 0) {
            dictSet(labelDict, "P", cosString(prefix));
          }
          numsItems.push(cosNumber(startPage - 1), labelDict);
        }
        dictSet(rootDict, "PageLabels", workingDoc.cos.allocateObject(cosDict({ Nums: cosArray(numsItems) })));
      }
    }
  }

  // Apply --remove-info, --remove-metadata, --remove-structure, --remove-acroform
  if (generateAppearances && !removeAcroform) {
    generateDocumentFormAppearances(workingDoc.cos);
  }
  if (removeInfo || removeMetadata || removeStructure || removeAcroform) {
    const rootDict = asDict(workingDoc.cos.resolve(workingDoc.cos.rootRef));
    if (removeInfo) {
      if (rootDict) dictDelete(rootDict, "Metadata");
      const infoDict = workingDoc.cos.infoRef
        ? asDict(workingDoc.cos.resolve(workingDoc.cos.infoRef))
        : undefined;
      if (infoDict) {
        const modDate = dictGet(infoDict, "ModDate");
        infoDict.entries.length = 0;
        if (modDate) {
          dictSet(infoDict, "ModDate", modDate);
        } else {
          workingDoc.cos.infoRef = undefined;
        }
      }
    }
    if (removeMetadata && rootDict) {
      dictDelete(rootDict, "Metadata");
    }
    if (removeStructure && rootDict) {
      dictDelete(rootDict, "StructTreeRoot");
      dictDelete(rootDict, "MarkInfo");
    }
    if (removeAcroform && rootDict) {
      dictDelete(rootDict, "AcroForm");
    }
  }

  // Expand --copy-attachments-from
  for (const copySpec of copyAttachmentsSpecs) {
    const srcBytes = loadBytes(copySpec.file);
    if (!srcBytes) {
      return { exitCode: 2, stdout: "", stderr: `qpdf: cannot open ${copySpec.file}\n` };
    }
    const srcDoc = PdfDocument.load(srcBytes, copySpec.password ? { password: copySpec.password } : {});
    const srcRoot = asDict(srcDoc.cos.resolve(srcDoc.cos.rootRef));
    const srcNames = srcRoot ? asDict(srcDoc.cos.resolve(dictGet(srcRoot, "Names"))) : undefined;
    const srcEf = srcNames ? asDict(srcDoc.cos.resolve(dictGet(srcNames, "EmbeddedFiles"))) : undefined;
    const flatPairs: PdfCosNode[] = [];
    const collectSrcEf = (nodeDict: PdfCosDict | undefined, visited = new Set<number>()) => {
      if (!nodeDict) return;
      const nArr = asArray(srcDoc.cos.resolve(dictGet(nodeDict, "Names")));
      if (nArr) flatPairs.push(...nArr.items);
      const kArr = asArray(srcDoc.cos.resolve(dictGet(nodeDict, "Kids")));
      if (kArr) {
        for (const kid of kArr.items) {
          if (kid.kind === "ref") {
            if (visited.has(kid.objectNumber)) continue;
            visited.add(kid.objectNumber);
          }
          collectSrcEf(asDict(srcDoc.cos.resolve(kid)), visited);
        }
      }
    };
    collectSrcEf(srcEf);
    const srcNamesArr = flatPairs.length > 0 ? { items: flatPairs } : undefined;
    if (srcNamesArr) {
      for (let idx = 0; idx + 1 < srcNamesArr.items.length; idx += 2) {
        const kNode = srcDoc.cos.resolve(srcNamesArr.items[idx]);
        const origKey = kNode?.kind === "string" ? decodePdfString(kNode) : `att_${idx}`;
        const fsDict = asDict(srcDoc.cos.resolve(srcNamesArr.items[idx + 1]));
        if (!fsDict) continue;
        const ufNode = srcDoc.cos.resolve(dictGet(fsDict, "UF") ?? dictGet(fsDict, "F"));
        const fnStr = ufNode?.kind === "string" ? decodePdfString(ufNode) : origKey;
        const efDict = asDict(srcDoc.cos.resolve(dictGet(fsDict, "EF")));
        const stNode = efDict
          ? srcDoc.cos.resolve(
              dictGet(efDict, "UF") ??
                dictGet(efDict, "F") ??
                dictGet(efDict, "DOS") ??
                dictGet(efDict, "Mac") ??
                dictGet(efDict, "Unix")
            )
          : undefined;
        if (stNode?.kind === "stream") {
          const data = srcDoc.cos.decodeStream(stNode);
          const newKey = `${copySpec.prefix}${origKey}`;
          const rootDict = asDict(workingDoc.cos.resolve(workingDoc.cos.rootRef));
          if (rootDict) {
            let namesDict = asDict(workingDoc.cos.resolve(dictGet(rootDict, "Names")));
            if (!namesDict) {
              namesDict = cosDict({});
              dictSet(rootDict, "Names", workingDoc.cos.allocateObject(namesDict));
            }
            let efTree = asDict(workingDoc.cos.resolve(dictGet(namesDict, "EmbeddedFiles")));
            if (!efTree) {
              efTree = cosDict({ Names: cosArray([]) });
              dictSet(namesDict, "EmbeddedFiles", workingDoc.cos.allocateObject(efTree));
            }
            let namesArr = asArray(workingDoc.cos.resolve(dictGet(efTree, "Names")));
            if (!namesArr) {
              namesArr = cosArray([]);
              dictSet(efTree, "Names", namesArr);
            }
            for (let j = 0; j + 1 < namesArr.items.length; j += 2) {
              const exNode = workingDoc.cos.resolve(namesArr.items[j]);
              if (exNode?.kind === "string" && decodePdfString(exNode) === newKey) {
                return { exitCode: 2, stdout: "", stderr: `qpdf: duplicate attachment key ${newKey}\n` };
              }
            }
            const efStreamRef = workingDoc.cos.allocateObject(
              cosStream(data, {
                dict: cosDict({
                  Type: cosName("EmbeddedFile"),
                  Params: cosDict({ Size: cosNumber(data.byteLength) })
                })
              })
            );
            const fsRef = workingDoc.cos.allocateObject(
              cosDict({
                Type: cosName("Filespec"),
                F: cosString(fnStr),
                UF: cosString(fnStr),
                EF: cosDict({ F: efStreamRef, UF: efStreamRef })
              })
            );
            namesArr.items.push(cosString(newKey), fsRef);
          }
        }
      }
    }
  }

  // Apply --remove-attachment and --add-attachment
  if (removeAttachmentKeys.length > 0 || addAttachmentSpecs.length > 0) {
    const rootDict = asDict(workingDoc.cos.resolve(workingDoc.cos.rootRef));
    if (rootDict) {
      let namesDict = asDict(workingDoc.cos.resolve(dictGet(rootDict, "Names")));
      if (!namesDict) {
        namesDict = cosDict({});
        dictSet(rootDict, "Names", workingDoc.cos.allocateObject(namesDict));
      }
      let efTree = asDict(workingDoc.cos.resolve(dictGet(namesDict, "EmbeddedFiles")));
      if (!efTree) {
        efTree = cosDict({ Names: cosArray([]) });
        dictSet(namesDict, "EmbeddedFiles", workingDoc.cos.allocateObject(efTree));
      }
      const flattenedEfPairs: PdfCosNode[] = [];
      const flattenEfTree = (nodeDict: PdfCosDict | undefined, visited = new Set<number>()) => {
        if (!nodeDict) return;
        const nArr = asArray(workingDoc.cos.resolve(dictGet(nodeDict, "Names")));
        if (nArr) flattenedEfPairs.push(...nArr.items);
        const kArr = asArray(workingDoc.cos.resolve(dictGet(nodeDict, "Kids")));
        if (kArr) {
          for (const kid of kArr.items) {
            if (kid.kind === "ref") {
              if (visited.has(kid.objectNumber)) continue;
              visited.add(kid.objectNumber);
            }
            flattenEfTree(asDict(workingDoc.cos.resolve(kid)), visited);
          }
        }
      };
      flattenEfTree(efTree);
      dictDelete(efTree, "Kids");
      let namesArr = cosArray(flattenedEfPairs);
      dictSet(efTree, "Names", namesArr);

      if (removeAttachmentKeys.length > 0) {
        const remSet = new Set(removeAttachmentKeys);
        const kept: PdfCosNode[] = [];
        for (let k = 0; k + 1 < namesArr.items.length; k += 2) {
          const keyNode = workingDoc.cos.resolve(namesArr.items[k]);
          const keyStr = keyNode?.kind === "string" ? decodePdfString(keyNode) : "";
          if (!remSet.has(keyStr)) {
            kept.push(namesArr.items[k]!, namesArr.items[k + 1]!);
          }
        }
        dictSet(efTree, "Names", cosArray(kept));
        namesArr = asArray(dictGet(efTree, "Names"))!;
      }

      for (const addSpec of addAttachmentSpecs) {
        const attBytes = loadBytes(addSpec.file);
        if (!attBytes) {
          return { exitCode: 2, stdout: "", stderr: `qpdf: cannot open attachment ${addSpec.file}\n` };
        }
        let existingIdx = -1;
        for (let idx = 0; idx + 1 < namesArr.items.length; idx += 2) {
          const kNode = workingDoc.cos.resolve(namesArr.items[idx]);
          if (kNode?.kind === "string" && decodePdfString(kNode) === addSpec.key) {
            existingIdx = idx;
            break;
          }
        }
        if (existingIdx >= 0 && !addSpec.replace) {
          return { exitCode: 2, stdout: "", stderr: `qpdf: duplicate attachment key ${addSpec.key}\n` };
        }
        const efStreamRef = workingDoc.cos.allocateObject(
          cosStream(attBytes, {
            dict: cosDict({
              Type: cosName("EmbeddedFile"),
              Params: cosDict({ Size: cosNumber(attBytes.byteLength) })
            })
          })
        );
        const fsDict = cosDict({
          Type: cosName("Filespec"),
          F: cosString(addSpec.filename),
          UF: cosString(addSpec.filename),
          EF: cosDict({ F: efStreamRef, UF: efStreamRef })
        });
        if (addSpec.description) {
          dictSet(fsDict, "Desc", cosString(addSpec.description));
        }
        const fsRef = workingDoc.cos.allocateObject(fsDict);
        if (existingIdx >= 0) {
          namesArr.items[existingIdx + 1] = fsRef;
        } else {
          namesArr.items.push(cosString(addSpec.key), fsRef);
        }
      }
    }
  }

  const finalTarget = replaceInput ? inputFile : outputFile;
  if (!finalTarget) {
    return { exitCode: 2, stdout: "", stderr: "qpdf: an output file is required\n" };
  }
  if (!replaceInput && inputFile && finalTarget === inputFile) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: "qpdf: output file may not be the same as the input file (use --replace-input)\n"
    };
  }

  // Split pages if requested (--split-pages[=n])
  if (splitPagesGroup !== undefined) {
    const total = workingDoc.getPageCount();
    const padLen = String(total).length;
    const baseStem = finalTarget.toLowerCase().endsWith(".pdf") ? finalTarget.slice(0, -4) : finalTarget;
    const wMeta = workingDoc.getMetadata();
    const formatSplitSpec = (tmpl: string, sNum: number, eNum: number): string | undefined => {
      let out = "";
      let replaced = false;
      for (let i = 0; i < tmpl.length; i++) {
        if (tmpl[i] !== "%") {
          out += tmpl[i]!;
          continue;
        }
        if (tmpl[i + 1] === "%") {
          out += "%";
          i++;
          continue;
        }
        if (!replaced) {
          let j = i + 1;
          let zeroPad = false;
          if (tmpl[j] === "0") {
            zeroPad = true;
            j++;
          }
          let wStr = "";
          while (j < tmpl.length && tmpl[j]! >= "0" && tmpl[j]! <= "9") {
            wStr += tmpl[j]!;
            j++;
          }
          if (tmpl[j] === "d") {
            const width = wStr ? Number.parseInt(wStr, 10) : padLen;
            const fmtN = (n: number) => (zeroPad || !wStr ? String(n).padStart(width, "0") : String(n));
            out += splitPagesGroup === 1 ? fmtN(sNum) : `${fmtN(sNum)}-${fmtN(eNum)}`;
            replaced = true;
            i = j;
            continue;
          }
        }
        out += "%";
      }
      return replaced ? out : undefined;
    };
    for (let startIdx = 0; startIdx < total; startIdx += splitPagesGroup) {
      const endIdx = Math.min(total - 1, startIdx + splitPagesGroup - 1);
      const subDoc = PdfDocument.create();
      if (wMeta.title) subDoc.setTitle(wMeta.title);
      if (wMeta.author) subDoc.setAuthor(wMeta.author);
      if (wMeta.subject) subDoc.setSubject(wMeta.subject);
      if (wMeta.keywords) subDoc.setKeywords(wMeta.keywords);
      const indices: number[] = [];
      for (let k = startIdx; k <= endIdx; k++) indices.push(k);
      subDoc.copyPagesFrom(workingDoc, indices);
      const sPad = String(startIdx + 1).padStart(padLen, "0");
      const ePad = String(endIdx + 1).padStart(padLen, "0");
      const suffix = splitPagesGroup === 1 ? sPad : `${sPad}-${ePad}`;
      const formattedSpec = formatSplitSpec(finalTarget, startIdx + 1, endIdx + 1);
      const splitName = formattedSpec ?? `${baseStem}-${suffix}.pdf`;
      files.set(splitName, subDoc.save({ normalizeContent: qdf }));
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  // Save final PDF
  const shouldNormalizeContent =
    normalizeContentFlag !== undefined
      ? normalizeContentFlag
      : qdf || streamDataMode === "uncompress";
  let outBytes = workingDoc.save({
    normalizeContent: shouldNormalizeContent,
    objectStreams: objectStreamsMode
  });

  if (encryptConfig && !decrypt) {
    const parsedOut = parseCosDocument(outBytes);
    outBytes = encryptCosDocument(parsedOut, {
      userPassword: encryptConfig.userPassword,
      ownerPassword: encryptConfig.ownerPassword,
      permissions: {
        print: encryptConfig.print,
        modify: encryptConfig.modify,
        copy: encryptConfig.copy,
        addNotes: encryptConfig.addNotes
      }
    });
  } else if (decrypt && workingDoc.cos.encryption) {
    // Strip encryption state and reserialize clean objects
    workingDoc.cos.encryptRef = undefined;
    workingDoc.cos.encryption = undefined;
    outBytes = serializeCosDocument({
      objects: [...workingDoc.cos.objects.values()],
      rootRef: workingDoc.cos.rootRef,
      infoRef: workingDoc.cos.infoRef
    });
  }

  files.set(finalTarget, outBytes);
  return { exitCode: repairedWarning && !warningExit0 ? 3 : 0, stdout: "", stderr: "" };
}

export async function qpdf(context: CommandContext): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];

    // Collect referenced VFS files into a working Map and write back any modified/created outputs
    const vfsFiles = new Map<string, Uint8Array>();
    const resolveVfsPath = (p: string) =>
      p.startsWith("/") ? p : `${context.cwd === "/" ? "" : context.cwd}/${p}`;
    let accountedBytes = 0;
    const chargeBytes = (delta: number) => {
      if (delta > 0) {
        accountedBytes += delta;
        context.inputBudget?.check(accountedBytes);
      }
    };

    // qpdf argument files contain one argument per line, resolved from the cwd.
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]!;
      if (!token.startsWith("@")) continue;
      const path = token.slice(1);
      let bytes: Uint8Array;
      try {
        bytes = await context.fs.readFile(resolveVfsPath(path), { signal: invocation.signal });
      } catch {
        await writeBytes(context.stderr, new TextEncoder().encode(`qpdf: cannot open ${path}\n`), invocation.signal);
        return { exitCode: 2 };
      }
      chargeBytes(bytes.byteLength);
      const args = new TextDecoder().decode(bytes).split("\n").map(line => line.endsWith("\r") ? line.slice(0, -1) : line).filter(line => line.length > 0);
      argv.splice(i, 1, ...args);
      // Argument-file contents are arguments, not recursively expanded files.
      i += args.length - 1;
    }

    for (const token of argv) {
      let candidate = token;
      if (
        token.startsWith("--overlay=") ||
        token.startsWith("--underlay=") ||
        token.startsWith("--update-from-json=")
      ) {
        candidate = token.slice(token.indexOf("=") + 1);
      } else if (token.startsWith("-") || token === "--" || token === ".") {
        continue;
      }
      const abs = resolveVfsPath(candidate);
      try {
        const bytes = await context.fs.readFile(abs, { signal: invocation.signal });
        chargeBytes(bytes.byteLength);
        vfsFiles.set(candidate, bytes);
      } catch {
        // Might be an output file or range spec
      }
    }

    if (argv.includes("--json-input") || argv.some((t) => t.startsWith("--update-from-json="))) {
      for (const fileBytes of [...vfsFiles.values()]) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(fileBytes)) as Record<string, unknown>;
          const objs =
            Array.isArray(parsed.qpdf) && typeof parsed.qpdf[1] === "object"
              ? (parsed.qpdf[1] as Record<string, unknown>)
              : typeof parsed.objects === "object" && parsed.objects !== null
                ? (parsed.objects as Record<string, unknown>)
                : undefined;
          if (!objs) continue;
          for (const entry of Object.values(objs)) {
            if (typeof entry === "object" && entry !== null && "stream" in entry) {
              const st = (entry as { stream?: { datafile?: unknown } }).stream;
              if (st && typeof st.datafile === "string" && !vfsFiles.has(st.datafile)) {
                const dfBytes = await context.fs.readFile(resolveVfsPath(st.datafile), {
                  signal: invocation.signal,
                });
                chargeBytes(dfBytes.byteLength);
                vfsFiles.set(st.datafile, dfBytes);
              }
            }
          }
        } catch {
          // Not a JSON file or missing external stream file
        }
      }
    }

    const existingSnap = new Map(vfsFiles);
    const res = await runQpdfCli(argv, vfsFiles, async () => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chargeBytes(chunk.byteLength);
        chunks.push(chunk);
        total += chunk.byteLength;
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      vfsFiles.set("-", bytes);
      existingSnap.set("-", bytes);
    });

    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdout) {
      const outBytes = new TextEncoder().encode(res.stdout);
      chargeBytes(outBytes.byteLength);
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, outBytes, invocation.signal);
    }

    for (const [fileKey, fileBytes] of vfsFiles.entries()) {
      if (existingSnap.get(fileKey) !== fileBytes) {
        chargeBytes(fileBytes.byteLength);
        if (fileKey === "-") {
          const stdout = invocation.child(context.stdout);
          await writeBytes(stdout.output, fileBytes, invocation.signal);
        } else {
          const abs = resolveVfsPath(fileKey);
          await context.fs.writeFile(abs, fileBytes, { signal: invocation.signal });
        }
      }
    }

    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createQpdfCommand(_options: QpdfCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "qpdf",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Structural PDF inspection, encryption, page selection, and transformation via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return qpdf(context);
    }
  });
}

export const qpdfCommand: CommandDefinition = createQpdfCommand();

export function qpdfCommands(options: QpdfCommandOptions = {}): VirtualShellPlugin {
  const command = createQpdfCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "qpdf",
    setup(host) {
      host.commands.register(command, { replace });
    }
  };
}
