import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition,
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosHexString,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  decodePdfString,
  dictDelete,
  dictGet,
  dictSet,
  flattenDocumentFormFields,
  getDocumentFormFields,
  parseFormDataBytes,
  resolveDestinationPageIndex,
  setDocumentFormField,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosRef,
} from "@poe-code/pdf-ast";

export interface PdftkCommandOptions {
  readonly replace?: boolean;
}

export interface PdftkCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes?: Uint8Array | undefined;
}

const PDFTK_OPERATIONS = new Set([
  "cat",
  "shuffle",
  "burst",
  "dump_data",
  "dump_data_utf8",
  "dump_data_annots",
  "dump_data_annots_utf8",
  "dump_data_fields",
  "dump_data_fields_utf8",
  "update_info",
  "update_info_utf8",
  "generate_fdf",
  "attach_files",
  "unpack_files",
  "fill_form",
  "flatten",
  "rotate",
  "background",
  "multibackground",
  "stamp",
  "multistamp",
  "output",
  "input_pw",
]);

interface RotationSpec {
  readonly kind: "absolute" | "relative";
  readonly degrees: number;
}

function parseRotationSuffix(raw: string): { rest: string; rotation?: RotationSpec | undefined } {
  const lower = raw.toLowerCase();
  const wordRotations: Array<[string, RotationSpec]> = [
    ["north", { kind: "absolute", degrees: 0 }],
    ["east", { kind: "absolute", degrees: 90 }],
    ["south", { kind: "absolute", degrees: 180 }],
    ["west", { kind: "absolute", degrees: 270 }],
    ["right", { kind: "relative", degrees: 90 }],
    ["left", { kind: "relative", degrees: -90 }],
    ["down", { kind: "relative", degrees: 180 }],
  ];
  for (const [word, spec] of wordRotations) {
    if (lower.endsWith(word) && raw.length >= word.length) {
      return { rest: raw.slice(0, -word.length), rotation: spec };
    }
  }
  if (lower.endsWith("end") || lower.endsWith("odd") || lower.endsWith("even")) {
    return { rest: raw };
  }
  const lastChar = raw[raw.length - 1];
  if (raw.length > 1 && lastChar) {
    const singleMap: Record<string, RotationSpec> = {
      N: { kind: "absolute", degrees: 0 },
      E: { kind: "absolute", degrees: 90 },
      S: { kind: "absolute", degrees: 180 },
      W: { kind: "absolute", degrees: 270 },
      R: { kind: "relative", degrees: 90 },
      L: { kind: "relative", degrees: -90 },
      D: { kind: "relative", degrees: 180 },
    };
    const spec = singleMap[lastChar.toUpperCase()];
    if (spec) {
      return { rest: raw.slice(0, -1), rotation: spec };
    }
  }
  return { rest: raw };
}

function resolvePageEndpoint(token: string, totalPages: number): number {
  const lower = token.toLowerCase();
  if (lower === "end") return totalPages;
  if (lower === "rend") return 1;
  if (lower.startsWith("r")) {
    const n = Number.parseInt(lower.slice(1), 10);
    if (Number.isFinite(n) && n >= 1) {
      return Math.max(1, totalPages - n + 1);
    }
  }
  const num = Number.parseInt(lower, 10);
  return Number.isFinite(num) && num >= 1 ? Math.min(totalPages, num) : 1;
}

export interface ExpandedPageSelection {
  readonly handle: string;
  readonly pageNumber: number;
  readonly rotation?: RotationSpec | undefined;
}

export function parsePdftkRangeToken(
  token: string,
  handles: ReadonlyMap<string, PdfDocument>,
  defaultHandle: string
): ExpandedPageSelection[] {
  let work = token.trim();
  let handle = defaultHandle;

  const sortedHandleKeys = [...handles.keys()].sort((a, b) => b.length - a.length);
  for (const hKey of sortedHandleKeys) {
    if (hKey && work.startsWith(hKey)) {
      const after = work.slice(hKey.length);
      const afterLower = after.toLowerCase();
      if (
        after.length === 0 ||
        (after[0]! >= "0" && after[0]! <= "9") ||
        afterLower.startsWith("end") ||
        afterLower.startsWith("r") ||
        afterLower.startsWith("even") ||
        afterLower.startsWith("odd") ||
        afterLower === "north" ||
        afterLower === "east" ||
        afterLower === "south" ||
        afterLower === "west" ||
        afterLower === "left" ||
        afterLower === "right" ||
        afterLower === "down"
      ) {
        handle = hKey;
        work = after;
        break;
      }
    }
  }

  const doc = handles.get(handle);
  const totalPages = Math.max(1, doc?.pageCount ?? 1);

  let qualifier: "even" | "odd" | undefined;
  if (work.toLowerCase().endsWith("even")) {
    qualifier = "even";
    work = work.slice(0, -4);
  } else if (work.toLowerCase().endsWith("odd")) {
    qualifier = "odd";
    work = work.slice(0, -3);
  }

  const { rest: afterRot, rotation } = parseRotationSuffix(work);
  work = afterRot;

  if (work.toLowerCase().endsWith("even")) {
    qualifier = "even";
    work = work.slice(0, -4);
  } else if (work.toLowerCase().endsWith("odd")) {
    qualifier = "odd";
    work = work.slice(0, -3);
  }

  let startPage = 1;
  let endPage = totalPages;
  if (work.length > 0) {
    const dashIdx = work.indexOf("-");
    if (dashIdx === -1) {
      startPage = resolvePageEndpoint(work, totalPages);
      endPage = startPage;
    } else {
      startPage = resolvePageEndpoint(work.slice(0, dashIdx), totalPages);
      endPage = resolvePageEndpoint(work.slice(dashIdx + 1), totalPages);
    }
  }

  const pages: number[] = [];
  if (startPage <= endPage) {
    for (let p = startPage; p <= endPage; p++) pages.push(p);
  } else {
    for (let p = startPage; p >= endPage; p--) pages.push(p);
  }

  const filtered = pages.filter(p => {
    if (qualifier === "even") return p % 2 === 0;
    if (qualifier === "odd") return p % 2 === 1;
    return true;
  });

  return filtered.map(pageNumber => ({
    handle,
    pageNumber,
    rotation,
  }));
}

function encodePdftkText(str: string, utf8: boolean): string {
  if (utf8) return str;
  let out = "";
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 127) {
      out += `&#${cp};`;
    } else {
      out += ch;
    }
  }
  return out;
}

function decodePdftkEntities(str: string): string {
  let out = "";
  let i = 0;
  while (i < str.length) {
    if (str[i] === "&" && str[i + 1] === "#") {
      const semi = str.indexOf(";", i + 2);
      if (semi !== -1) {
        const body = str.slice(i + 2, semi);
        const cp =
          body.startsWith("x") || body.startsWith("X")
            ? Number.parseInt(body.slice(1), 16)
            : Number.parseInt(body, 10);
        if (Number.isFinite(cp) && cp >= 0) {
          out += String.fromCodePoint(cp);
          i = semi + 1;
          continue;
        }
      }
    }
    out += str[i]!;
    i++;
  }
  return out;
}

function escapeFdfString(str: string): string {
  return str
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

function formatDumpDataFields(doc: PdfDocument, utf8 = true): string {
  const fields = getDocumentFormFields(doc.cos);
  if (fields.length === 0) return "";
  const stanzas: string[] = [];
  for (const field of fields) {
    const fieldType =
      field.type === "text"
        ? "Text"
        : field.type === "checkbox"
          ? "Button"
          : field.type === "choice"
            ? "Choice"
            : "Text";
    const flags = field.flags ?? 0;
    const options = field.options ?? [];
    let valStr = "";
    if (field.stateValue !== undefined) {
      valStr = field.stateValue;
    } else if (typeof field.value === "boolean") {
      const onState = options.find(o => o !== "Off") ?? "Yes";
      valStr = field.value ? onState : "Off";
    } else {
      valStr = String(field.value ?? "");
    }
    const lines = [
      "---",
      `FieldType: ${fieldType}`,
      `FieldName: ${encodePdftkText(field.name, utf8)}`,
    ];
    if (field.altName) {
      lines.push(`FieldNameAlt: ${encodePdftkText(field.altName, utf8)}`);
    }
    lines.push(`FieldFlags: ${flags}`);
    if (field.selectedValues && field.selectedValues.length > 0) {
      for (const sv of field.selectedValues) {
        lines.push(`FieldValue: ${encodePdftkText(sv, utf8)}`);
      }
    } else {
      lines.push(`FieldValue: ${encodePdftkText(valStr, utf8)}`);
    }
    if (field.defaultValue !== undefined && field.defaultValue !== "") {
      lines.push(`FieldValueDefault: ${encodePdftkText(field.defaultValue, utf8)}`);
    }
    lines.push(`FieldJustification: ${field.justification ?? "Left"}`);
    for (const opt of options) {
      lines.push(`FieldStateOption: ${encodePdftkText(opt, utf8)}`);
    }
    if (field.maxLength !== undefined) {
      lines.push(`FieldMaxLength: ${field.maxLength}`);
    }
  stanzas.push(lines.join("\n"));
  }
  return stanzas.join("\n") + "\n";
}

function formatDumpDataAnnots(doc: PdfDocument, utf8 = false): string {
  const lines: string[] = [];
  const id0Node = doc.cos.idArray?.items[0] ? doc.cos.resolve(doc.cos.idArray.items[0]) : undefined;
  const id1Node = doc.cos.idArray?.items[1] ? doc.cos.resolve(doc.cos.idArray.items[1]) : undefined;
  const id0Hex = id0Node?.kind === "string" ? bytesToHexLower(id0Node.bytes) : "00000000000000000000000000000000";
  const id1Hex = id1Node?.kind === "string" ? bytesToHexLower(id1Node.bytes) : "00000000000000000000000000000000";
  lines.push(`PdfID0: ${id0Hex}`);
  lines.push(`PdfID1: ${id1Hex}`);
  lines.push(`NumberOfPages: ${doc.pageCount}`);

  for (let p = 0; p < doc.pageCount; p++) {
    const pageDict = doc.getPage(p).pageDict;
    const annotsArr = doc.cos.resolveArray(dictGet(pageDict, "Annots"));
    if (!annotsArr) continue;
    for (const item of annotsArr.items) {
      const annotDict = doc.cos.resolveDict(item);
      if (!annotDict) continue;
      const subNode = doc.cos.resolve(dictGet(annotDict, "Subtype"));
      const subtype = subNode?.kind === "name" ? subNode.decoded : "Annot";
      const rectArr = doc.cos.resolveArray(dictGet(annotDict, "Rect"));
      const rectNums = rectArr
        ? rectArr.items.map(it => {
            const r = doc.cos.resolve(it);
            return r?.kind === "number" ? r.value : 0;
          })
        : [0, 0, 0, 0];
      const flagsNode = doc.cos.resolve(dictGet(annotDict, "F"));
      const flags = flagsNode?.kind === "number" ? flagsNode.value : 0;

      lines.push("---");
      lines.push(`AnnotSubtype: ${subtype}`);
      lines.push(`AnnotRect: ${rectNums.slice(0, 4).join(" ")}`);
      const nmNode = doc.cos.resolve(dictGet(annotDict, "NM"));
      if (nmNode?.kind === "string") {
        lines.push(`AnnotName: ${encodePdftkText(decodePdfString(nmNode), utf8)}`);
      }
      const tNode = doc.cos.resolve(dictGet(annotDict, "T"));
      if (tNode?.kind === "string") {
        lines.push(`AnnotTitle: ${encodePdftkText(decodePdfString(tNode), utf8)}`);
      }
      const subjNode = doc.cos.resolve(dictGet(annotDict, "Subj"));
      if (subjNode?.kind === "string") {
        lines.push(`AnnotSubj: ${encodePdftkText(decodePdfString(subjNode), utf8)}`);
      }
      const cNode = doc.cos.resolve(dictGet(annotDict, "Contents"));
      if (cNode?.kind === "string") {
        lines.push(`AnnotContents: ${encodePdftkText(decodePdfString(cNode), utf8)}`);
      }
      const colArr = doc.cos.resolveArray(dictGet(annotDict, "C"));
      if (colArr && colArr.items.length >= 3) {
        const colNums = colArr.items.slice(0, 3).map(it => {
          const r = doc.cos.resolve(it);
          return r?.kind === "number" ? r.value : 0;
        });
        lines.push(`AnnotColor: ${colNums.join(" ")}`);
      }
      const openNode = doc.cos.resolve(dictGet(annotDict, "Open"));
      if (openNode?.kind === "boolean") {
        lines.push(`AnnotOpen: ${openNode.value}`);
      }
      const mNode = doc.cos.resolve(dictGet(annotDict, "M"));
      if (mNode?.kind === "string") {
        lines.push(`AnnotModificationDate: ${encodePdftkText(decodePdfString(mNode), utf8)}`);
      }
      lines.push(`AnnotFlags: ${flags}`);
      lines.push(`AnnotPageNumber: ${p + 1}`);

      const formatDestTarget = (dRaw: PdfCosNode | undefined): string | undefined => {
        if (!dRaw) return undefined;
        const resolved = doc.cos.resolve(dRaw);
        if (resolved?.kind === "string") return decodePdfString(resolved);
        if (resolved?.kind === "name") return resolved.decoded;
        if (resolved?.kind === "array" && resolved.items.length > 0) {
          const first = resolved.items[0];
          if (first?.kind === "ref") {
            for (let pi = 0; pi < doc.pageCount; pi++) {
              if (doc.getPage(pi).ref.objectNumber === first.objectNumber) {
                return `page ${pi + 1}`;
              }
            }
          } else if (first?.kind === "number") {
            return `page ${first.value + 1}`;
          }
        }
        if (resolved?.kind === "dict") {
          const idx = resolveDestinationPageIndex(doc, resolved);
          if (idx !== undefined) return `page ${idx + 1}`;
        }
        return undefined;
      };

      const emitActionChain = (aNode: PdfCosNode | undefined, visited = new Set<number>()) => {
        if (!aNode) return;
        if (aNode.kind === "ref") {
          if (visited.has(aNode.objectNumber)) return;
          visited.add(aNode.objectNumber);
        }
        const aArr = doc.cos.resolveArray(aNode);
        if (aArr) {
          for (const item of aArr.items) emitActionChain(item, visited);
          return;
        }
        const actionDict = doc.cos.resolveDict(aNode);
        if (!actionDict) return;
        const sNode = doc.cos.resolve(dictGet(actionDict, "S"));
        const sType = sNode?.kind === "name" ? sNode.decoded : "";
        if (sType) {
          lines.push(`AnnotActionType: ${sType}`);
        }
        const uriNode = doc.cos.resolve(dictGet(actionDict, "URI"));
        if (uriNode?.kind === "string") {
          lines.push(`AnnotActionURI: ${encodePdftkText(decodePdfString(uriNode), utf8)}`);
        }
        const dNode = dictGet(actionDict, "D");
        const destTarget = formatDestTarget(dNode);
        if (destTarget) {
          lines.push(`AnnotActionDest: ${encodePdftkText(destTarget, utf8)}`);
        }
        const resolvedIdx = resolveDestinationPageIndex(doc, dNode ?? actionDict);
        if (resolvedIdx !== undefined) {
          lines.push(`AnnotActionPageNumber: ${resolvedIdx + 1}`);
        }
        const fRaw = doc.cos.resolve(dictGet(actionDict, "F"));
        if (fRaw?.kind === "string") {
          lines.push(`AnnotActionFile: ${encodePdftkText(decodePdfString(fRaw), utf8)}`);
        } else if (fRaw?.kind === "dict") {
          const ufNode = doc.cos.resolve(dictGet(fRaw, "UF") ?? dictGet(fRaw, "F"));
          if (ufNode?.kind === "string") {
            lines.push(`AnnotActionFile: ${encodePdftkText(decodePdfString(ufNode), utf8)}`);
          }
        }
        emitActionChain(dictGet(actionDict, "Next"), visited);
      };

      const rawA = dictGet(annotDict, "A");
      if (rawA) {
        emitActionChain(rawA);
      } else if (dictGet(annotDict, "Dest")) {
        lines.push("AnnotActionType: GoTo");
        const dNode = dictGet(annotDict, "Dest");
        const destTarget = formatDestTarget(dNode);
        if (destTarget) {
          lines.push(`AnnotActionDest: ${encodePdftkText(destTarget, utf8)}`);
        }
        const resolvedIdx = resolveDestinationPageIndex(doc, dNode);
        if (resolvedIdx !== undefined) {
          lines.push(`AnnotActionPageNumber: ${resolvedIdx + 1}`);
        }
      }
    }
  }

  return lines.join("\n") + "\n";
}

function copyPrimaryMetadata(srcDoc: PdfDocument, dstDoc: PdfDocument): void {
  const meta = srcDoc.getMetadata();
  if (meta.title) dstDoc.setTitle(meta.title);
  if (meta.author) dstDoc.setAuthor(meta.author);
  if (meta.subject) dstDoc.setSubject(meta.subject);
  if (meta.keywords) dstDoc.setKeywords(meta.keywords);
  if (meta.creator) dstDoc.setCreator(meta.creator);
  if (meta.producer) dstDoc.setProducer(meta.producer);
}

const PAGE_LABEL_STYLE_TO_PDF: Record<string, string> = {
  DecimalArabicNumerals: "D",
  UppercaseRomanNumerals: "R",
  LowercaseRomanNumerals: "r",
  UppercaseLetters: "A",
  LowercaseLetters: "a",
};

const PDF_TO_PAGE_LABEL_STYLE: Record<string, string> = {
  D: "DecimalArabicNumerals",
  R: "UppercaseRomanNumerals",
  r: "LowercaseRomanNumerals",
  A: "UppercaseLetters",
  a: "LowercaseLetters",
};

function collectOutlineBookmarks(
  doc: PdfDocument,
  firstNode: PdfCosNode | undefined,
  level: number,
  out: Array<{ title: string; level: number; pageNumber: number }>,
  visited = new Set<number>()
): void {
  let curr = firstNode;
  while (curr) {
    if (curr.kind === "ref") {
      if (visited.has(curr.objectNumber)) break;
      visited.add(curr.objectNumber);
    }
    const dict = doc.cos.resolveDict(curr);
    if (!dict) break;
    const titleNode = doc.cos.resolve(dictGet(dict, "Title"));
    const title =
      titleNode?.kind === "string"
        ? decodePdfString(titleNode)
        : titleNode?.kind === "name"
          ? titleNode.decoded
          : "";
    const resolvedIdx = resolveDestinationPageIndex(doc, dictGet(dict, "Dest") ?? dictGet(dict, "A"));
    const pageNumber = resolvedIdx !== undefined ? resolvedIdx + 1 : 1;
    if (title) {
      out.push({ title, level, pageNumber });
    }
    const childFirst = dictGet(dict, "First");
    if (childFirst) {
      collectOutlineBookmarks(doc, childFirst, level + 1, out, visited);
    }
    curr = dictGet(dict, "Next");
  }
}

function collectNameTreePairs(
  doc: PdfDocument,
  nodeOrRef: PdfCosNode | undefined,
  out: Array<{ name: string; value: PdfCosNode }>,
  visited = new Set<number>()
): void {
  if (!nodeOrRef) return;
  if (nodeOrRef.kind === "ref") {
    if (visited.has(nodeOrRef.objectNumber)) return;
    visited.add(nodeOrRef.objectNumber);
  }
  const dict = doc.cos.resolveDict(nodeOrRef);
  if (!dict) return;
  const namesArr = doc.cos.resolveArray(dictGet(dict, "Names"));
  if (namesArr) {
    for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
      const k = doc.cos.resolve(namesArr.items[i]);
      const v = namesArr.items[i + 1]!;
      const name = k?.kind === "string" ? decodePdfString(k) : "attachment.bin";
      out.push({ name, value: v });
    }
  }
  const kidsArr = doc.cos.resolveArray(dictGet(dict, "Kids"));
  if (kidsArr) {
    for (const kid of kidsArr.items) {
      collectNameTreePairs(doc, kid, out, visited);
    }
  }
}

function collectNumberTreePairs(
  doc: PdfDocument,
  nodeOrRef: PdfCosNode | undefined,
  out: Array<{ num: number; value: PdfCosNode }>,
  visited = new Set<number>()
): void {
  if (!nodeOrRef) return;
  if (nodeOrRef.kind === "ref") {
    if (visited.has(nodeOrRef.objectNumber)) return;
    visited.add(nodeOrRef.objectNumber);
  }
  const dict = doc.cos.resolveDict(nodeOrRef);
  if (!dict) return;
  const numsArr = doc.cos.resolveArray(dictGet(dict, "Nums"));
  if (numsArr) {
    for (let i = 0; i + 1 < numsArr.items.length; i += 2) {
      const k = doc.cos.resolve(numsArr.items[i]);
      const v = numsArr.items[i + 1]!;
      if (k?.kind === "number") {
        out.push({ num: k.value, value: v });
      }
    }
  }
  const kidsArr = doc.cos.resolveArray(dictGet(dict, "Kids"));
  if (kidsArr) {
    for (const kid of kidsArr.items) {
      collectNumberTreePairs(doc, kid, out, visited);
    }
  }
}

function bytesToHexLower(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const byteVal = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isNaN(byteVal) ? 0 : byteVal;
  }
  return out;
}

function formatDumpData(doc: PdfDocument, utf8 = true): string {
  const meta = doc.getMetadata();
  const lines: string[] = [];
  const emittedKeys = new Set<string>();
  const infoEntries: Array<[string, string | undefined]> = [
    ["Title", meta.title],
    ["Author", meta.author],
    ["Subject", meta.subject],
    ["Keywords", meta.keywords],
    ["Creator", meta.creator],
    ["Producer", meta.producer],
  ];
  for (const [key, val] of infoEntries) {
    if (val !== undefined && val !== "") {
      emittedKeys.add(key);
      lines.push(
        "InfoBegin",
        `InfoKey: ${encodePdftkText(key, utf8)}`,
        `InfoValue: ${encodePdftkText(val, utf8)}`
      );
    }
  }
  if (doc.cos.infoRef) {
    const infoDict = doc.cos.resolveDict(doc.cos.infoRef);
    if (infoDict) {
      for (const entry of infoDict.entries) {
        const k = entry.key.decoded;
        if (emittedKeys.has(k)) continue;
        const r = doc.cos.resolve(entry.value);
        if (r?.kind === "string") {
          const val = decodePdfString(r);
          if (val) {
            emittedKeys.add(k);
            lines.push(
              "InfoBegin",
              `InfoKey: ${encodePdftkText(k, utf8)}`,
              `InfoValue: ${encodePdftkText(val, utf8)}`
            );
          }
        }
      }
    }
  }
  const id0Node = doc.cos.idArray?.items[0] ? doc.cos.resolve(doc.cos.idArray.items[0]) : undefined;
  const id1Node = doc.cos.idArray?.items[1] ? doc.cos.resolve(doc.cos.idArray.items[1]) : undefined;
  const id0Hex = id0Node?.kind === "string" ? bytesToHexLower(id0Node.bytes) : "00000000000000000000000000000000";
  const id1Hex = id1Node?.kind === "string" ? bytesToHexLower(id1Node.bytes) : "00000000000000000000000000000000";
  lines.push(`PdfID0: ${id0Hex}`);
  lines.push(`PdfID1: ${id1Hex}`);
  lines.push(`NumberOfPages: ${doc.pageCount}`);

  const catalog = doc.cos.resolveDict(doc.cos.rootRef);
  const outlinesDict = catalog ? doc.cos.resolveDict(dictGet(catalog, "Outlines")) : undefined;
  if (outlinesDict) {
    const bookmarks: Array<{ title: string; level: number; pageNumber: number }> = [];
    collectOutlineBookmarks(doc, dictGet(outlinesDict, "First"), 1, bookmarks);
    for (const bm of bookmarks) {
      lines.push(
        "BookmarkBegin",
        `BookmarkTitle: ${encodePdftkText(bm.title, utf8)}`,
        `BookmarkLevel: ${bm.level}`,
        `BookmarkPageNumber: ${bm.pageNumber}`
      );
    }
  }

  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();
    const rot = page.getRotation();
    const mbArr = doc.cos.resolveArray(dictGet(page.pageDict, "MediaBox"));
    let mbRectStr = `0 0 ${width} ${height}`;
    if (mbArr && mbArr.items.length >= 4) {
      const mbNums = mbArr.items.slice(0, 4).map(item => {
        const r = doc.cos.resolve(item);
        return r?.kind === "number" ? r.value : 0;
      });
      mbRectStr = `${mbNums[0]} ${mbNums[1]} ${mbNums[2]} ${mbNums[3]}`;
    }
    lines.push(
      "PageMediaBegin",
      `PageMediaNumber: ${i + 1}`,
      `PageMediaRotation: ${rot}`,
      `PageMediaRect: ${mbRectStr}`,
      `PageMediaDimensions: ${width} ${height}`
    );
    const cbArr = doc.cos.resolveArray(dictGet(page.pageDict, "CropBox"));
    if (cbArr && cbArr.items.length >= 4) {
      const nums = cbArr.items.slice(0, 4).map(item => {
        const r = doc.cos.resolve(item);
        return r?.kind === "number" ? r.value : 0;
      });
      lines.push(`PageMediaCropBox: ${nums[0]} ${nums[1]} ${nums[2]} ${nums[3]}`);
      lines.push(`PageMediaCropRect: ${nums[0]} ${nums[1]} ${nums[2]} ${nums[3]}`);
    }
  }

  const pageLabelsPairs: Array<{ num: number; value: PdfCosNode }> = [];
  if (catalog) {
    collectNumberTreePairs(doc, dictGet(catalog, "PageLabels"), pageLabelsPairs);
  }
  for (const pair of pageLabelsPairs) {
    const lblDict = doc.cos.resolveDict(pair.value);
    if (lblDict) {
      const newIndex = Math.max(1, pair.num + 1);
      const stNode = doc.cos.resolve(dictGet(lblDict, "St"));
      const startNum = stNode?.kind === "number" ? stNode.value : 1;
      const pNode = doc.cos.resolve(dictGet(lblDict, "P"));
      const prefix = pNode?.kind === "string" ? decodePdfString(pNode) : undefined;
      const sNode = doc.cos.resolve(dictGet(lblDict, "S"));
      const styleCode = sNode?.kind === "name" ? sNode.decoded : "";
      const numStyle = PDF_TO_PAGE_LABEL_STYLE[styleCode] ?? "NoNumber";
      lines.push(
        "PageLabelBegin",
        `PageLabelNewIndex: ${newIndex}`,
        `PageLabelStart: ${startNum}`
      );
      if (prefix !== undefined && prefix !== "") {
        lines.push(`PageLabelPrefix: ${encodePdftkText(prefix, utf8)}`);
      }
      lines.push(`PageLabelNumStyle: ${numStyle}`);
    }
  }

  return lines.join("\n") + "\n";
}

function formatGenerateFdf(doc: PdfDocument): string {
  const fields = getDocumentFormFields(doc.cos);
  const byFullName = new Map(fields.map(f => [f.name, f]));
  const formatFieldVal = (fullName: string, dict: PdfCosDict): string => {
    const f = byFullName.get(fullName);
    if (f) {
      if (typeof f.value === "boolean") {
        const onState = f.stateValue ?? (f.options ?? []).find(o => o !== "Off") ?? "Yes";
        return `/${f.value ? onState : "Off"}`;
      }
      if (f.selectedValues && f.selectedValues.length > 1) {
        return `[ ${f.selectedValues.map(sv => `(${escapeFdfString(sv)})`).join(" ")} ]`;
      }
      return `(${escapeFdfString(String(f.value ?? ""))})`;
    }
    const vNode = doc.cos.resolve(dictGet(dict, "V"));
    if (vNode?.kind === "name") return `/${vNode.decoded}`;
    if (vNode?.kind === "string") return `(${escapeFdfString(decodePdfString(vNode))})`;
    return "()";
  };

  const serializeCosFieldNode = (nodeOrRef: PdfCosNode, prefix: string): string | undefined => {
    const dict = doc.cos.resolveDict(nodeOrRef);
    if (!dict) return undefined;
    const tNode = doc.cos.resolve(dictGet(dict, "T"));
    const partialName = tNode?.kind === "string" ? decodePdfString(tNode) : "";
    const fullName = prefix && partialName ? `${prefix}.${partialName}` : partialName || prefix;
    const kidsArr = doc.cos.resolveArray(dictGet(dict, "Kids"));
    const namedKids: string[] = [];
    if (kidsArr) {
      for (const k of kidsArr.items) {
        const kDict = doc.cos.resolveDict(k);
        if (kDict && dictGet(kDict, "T")) {
          const serializedKid = serializeCosFieldNode(k, fullName);
          if (serializedKid) namedKids.push(serializedKid);
        }
      }
    }
    if (namedKids.length > 0) {
      return `<< /T (${escapeFdfString(partialName || fullName)}) /Kids [ ${namedKids.join(" ")} ] >>`;
    }
    if (!partialName && !fullName) return undefined;
    return `<< /T (${escapeFdfString(partialName || fullName)}) /V ${formatFieldVal(fullName, dict)} >>`;
  };

  const entries: string[] = [];
  const catalog = doc.cos.resolveDict(doc.cos.rootRef);
  const acroForm = catalog ? doc.cos.resolveDict(dictGet(catalog, "AcroForm")) : undefined;
  const fieldsArr = acroForm ? doc.cos.resolveArray(dictGet(acroForm, "Fields")) : undefined;
  if (fieldsArr && fieldsArr.items.length > 0) {
    for (const item of fieldsArr.items) {
      const s = serializeCosFieldNode(item, "");
      if (s) entries.push(s);
    }
  } else {
    for (const f of fields) {
      entries.push(`<< /T (${escapeFdfString(f.name)}) /V ${formatFieldVal(f.name, cosDict({}))} >>`);
    }
  }

  return `%FDF-1.2
1 0 obj
<< /FDF << /Fields [
${entries.map(e => "  " + e).join("\n")}
] >> >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`;
}

function setDocumentBookmarks(
  doc: PdfDocument,
  bookmarks: ReadonlyArray<{ title: string; level: number; pageNumber: number }>
): void {
  if (bookmarks.length === 0 || doc.pageCount === 0) return;
  const catalog = doc.cos.resolveDict(doc.cos.rootRef);
  if (!catalog) return;
  const outlinesDict = cosDict({ Type: cosName("Outlines") });
  const outlinesRef = doc.cos.allocateObject(outlinesDict);
  dictSet(catalog, "Outlines", outlinesRef);

  interface OutlineParentState {
    ref: ReturnType<typeof doc.cos.allocateObject>;
    dict: PdfCosDict;
    children: Array<{ ref: ReturnType<typeof doc.cos.allocateObject>; dict: PdfCosDict }>;
  }
  const stack: OutlineParentState[] = [{ ref: outlinesRef, dict: outlinesDict, children: [] }];

  for (const bm of bookmarks) {
    const targetLevel = Math.max(1, bm.level);
    while (stack.length > targetLevel) {
      stack.pop();
    }
    while (stack.length < targetLevel) {
      const top = stack[stack.length - 1]!;
      const lastChild = top.children[top.children.length - 1];
      if (lastChild) {
        stack.push({ ref: lastChild.ref, dict: lastChild.dict, children: [] });
      } else {
        break;
      }
    }
    const parentState = stack[stack.length - 1]!;
    const pageIdx = Math.max(0, Math.min(doc.pageCount - 1, bm.pageNumber - 1));
    const pageRef = doc.getPage(pageIdx).ref;
    const itemDict = cosDict({
      Title: cosString(bm.title),
      Parent: parentState.ref,
      Dest: cosArray([pageRef, cosName("XYZ"), { kind: "null" }, { kind: "null" }, { kind: "null" }]),
    });
    const itemRef = doc.cos.allocateObject(itemDict);
    const prevSibling = parentState.children[parentState.children.length - 1];
    if (prevSibling) {
      dictSet(prevSibling.dict, "Next", itemRef);
      dictSet(itemDict, "Prev", prevSibling.ref);
    } else {
      dictSet(parentState.dict, "First", itemRef);
    }
    dictSet(parentState.dict, "Last", itemRef);
    parentState.children.push({ ref: itemRef, dict: itemDict });
    dictSet(parentState.dict, "Count", cosNumber(parentState.children.length));
  }
}

function applyUpdateInfoText(doc: PdfDocument, text: string): void {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  let mode: "none" | "info" | "bookmark" | "pagelabel" | "pagemedia" = "none";
  let curKey = "";
  let bmTitle = "";
  let bmLevel = 1;
  let bmPage = 1;
  const bookmarks: Array<{ title: string; level: number; pageNumber: number }> = [];

  let plNewIndex = 1;
  let plStart = 1;
  let plPrefix = "";
  let plStyle = "DecimalArabicNumerals";
  const pageLabels: Array<{ newIndex: number; start: number; prefix: string; style: string }> = [];

  let pmNumber = 0;
  let pmRotation: number | undefined;
  let pmMediaRect: [number, number, number, number] | undefined;
  let pmDimensions: [number, number] | undefined;
  let pmCropBox: [number, number, number, number] | undefined;
  const pageRotations = new Map<number, number>();
  const pageMediaRects = new Map<number, [number, number, number, number]>();
  const pageDimensions = new Map<number, [number, number]>();
  const pageCropBoxes = new Map<number, [number, number, number, number]>();
  let pdfId0Hex: string | undefined;
  let pdfId1Hex: string | undefined;

  const flushStanza = () => {
    if (mode === "bookmark" && bmTitle) {
      bookmarks.push({ title: bmTitle, level: Math.max(1, bmLevel), pageNumber: Math.max(1, bmPage) });
    } else if (mode === "pagelabel") {
      pageLabels.push({
        newIndex: Math.max(1, plNewIndex),
        start: Math.max(1, plStart),
        prefix: plPrefix,
        style: plStyle,
      });
    } else if (mode === "pagemedia" && pmNumber >= 1) {
      if (pmRotation !== undefined) pageRotations.set(pmNumber, pmRotation);
      if (pmMediaRect !== undefined) pageMediaRects.set(pmNumber, pmMediaRect);
      if (pmDimensions !== undefined) pageDimensions.set(pmNumber, pmDimensions);
      if (pmCropBox !== undefined) pageCropBoxes.set(pmNumber, pmCropBox);
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

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "InfoBegin") {
      flushStanza();
      mode = "info";
      curKey = "";
    } else if (line === "BookmarkBegin") {
      flushStanza();
      mode = "bookmark";
    } else if (line === "PageLabelBegin") {
      flushStanza();
      mode = "pagelabel";
    } else if (line === "PageMediaBegin") {
      flushStanza();
      mode = "pagemedia";
    } else if (line.startsWith("PdfID0:")) {
      pdfId0Hex = line.slice("PdfID0:".length).trim();
    } else if (line.startsWith("PdfID1:")) {
      pdfId1Hex = line.slice("PdfID1:".length).trim();
    } else if (mode === "info" && line.startsWith("InfoKey:")) {
      curKey = decodePdftkEntities(line.slice("InfoKey:".length).trim());
    } else if (mode === "info" && line.startsWith("InfoValue:") && curKey) {
      const val = decodePdftkEntities(line.slice("InfoValue:".length).trim());
      if (curKey === "Title") doc.setTitle(val);
      else if (curKey === "Author") doc.setAuthor(val);
      else if (curKey === "Subject") doc.setSubject(val);
      else if (curKey === "Keywords") doc.setKeywords(val);
      else if (curKey === "Creator") doc.setCreator(val);
      else if (curKey === "Producer") doc.setProducer(val);
      else {
        if (!doc.cos.infoRef) {
          doc.setTitle(doc.getMetadata().title ?? "");
        }
        const infoDict = doc.cos.infoRef ? doc.cos.resolveDict(doc.cos.infoRef) : undefined;
        if (infoDict) {
          dictSet(infoDict, curKey, cosString(val));
        }
      }
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

  if (pdfId0Hex !== undefined || pdfId1Hex !== undefined) {
    const existing0 =
      doc.cos.idArray?.items[0] && doc.cos.resolve(doc.cos.idArray.items[0])?.kind === "string"
        ? (doc.cos.resolve(doc.cos.idArray.items[0]) as { bytes: Uint8Array }).bytes
        : new Uint8Array(16);
    const existing1 =
      doc.cos.idArray?.items[1] && doc.cos.resolve(doc.cos.idArray.items[1])?.kind === "string"
        ? (doc.cos.resolve(doc.cos.idArray.items[1]) as { bytes: Uint8Array }).bytes
        : existing0;
    const b0 = pdfId0Hex !== undefined ? hexToBytes(pdfId0Hex) : existing0;
    const b1 = pdfId1Hex !== undefined ? hexToBytes(pdfId1Hex) : existing1;
    doc.cos.idArray = cosArray([cosHexString(b0), cosHexString(b1)]);
  }

  for (const [pageNum, rot] of pageRotations.entries()) {
    if (pageNum >= 1 && pageNum <= doc.pageCount) {
      doc.getPage(pageNum - 1).setRotation(normalizeQuarterTurn(rot));
    }
  }
  for (const [pageNum, [w, h]] of pageDimensions.entries()) {
    if (pageNum >= 1 && pageNum <= doc.pageCount) {
      dictSet(
        doc.getPage(pageNum - 1).pageDict,
        "MediaBox",
        cosArray([cosNumber(0), cosNumber(0), cosNumber(w), cosNumber(h)])
      );
    }
  }
  for (const [pageNum, [x0, y0, x1, y1]] of pageMediaRects.entries()) {
    if (pageNum >= 1 && pageNum <= doc.pageCount) {
      dictSet(
        doc.getPage(pageNum - 1).pageDict,
        "MediaBox",
        cosArray([cosNumber(x0), cosNumber(y0), cosNumber(x1), cosNumber(y1)])
      );
    }
  }
  for (const [pageNum, [x0, y0, x1, y1]] of pageCropBoxes.entries()) {
    if (pageNum >= 1 && pageNum <= doc.pageCount) {
      dictSet(
        doc.getPage(pageNum - 1).pageDict,
        "CropBox",
        cosArray([cosNumber(x0), cosNumber(y0), cosNumber(x1), cosNumber(y1)])
      );
    }
  }

  if (pageLabels.length > 0) {
    const catalog = doc.cos.resolveDict(doc.cos.rootRef);
    if (catalog) {
      const numsItems: PdfCosNode[] = [];
      for (const pl of pageLabels) {
        numsItems.push(cosNumber(Math.max(0, pl.newIndex - 1)));
        const lblEntries: Record<string, PdfCosNode> = {
          St: cosNumber(pl.start),
        };
        if (pl.prefix) {
          lblEntries.P = cosString(pl.prefix);
        }
        const pdfStyle = PAGE_LABEL_STYLE_TO_PDF[pl.style];
        if (pdfStyle) {
          lblEntries.S = cosName(pdfStyle);
        }
        numsItems.push(cosDict(lblEntries));
      }
      const plDict = cosDict({ Nums: cosArray(numsItems) });
      dictSet(catalog, "PageLabels", doc.cos.allocateObject(plDict));
    }
  }

  setDocumentBookmarks(doc, bookmarks);
}

function attachFilesToDocument(
  doc: PdfDocument,
  filePaths: readonly string[],
  files: ReadonlyMap<string, Uint8Array>,
  toPageSpec?: string
): void {
  const catalog = doc.cos.resolveDict(doc.cos.rootRef);
  if (!catalog) return;
  let namesDict = doc.cos.resolveDict(dictGet(catalog, "Names"));
  if (!namesDict) {
    namesDict = cosDict({});
    dictSet(catalog, "Names", doc.cos.allocateObject(namesDict));
  }
  let efTree = doc.cos.resolveDict(dictGet(namesDict, "EmbeddedFiles"));
  if (!efTree) {
    efTree = cosDict({ Names: cosArray([]) });
    dictSet(namesDict, "EmbeddedFiles", doc.cos.allocateObject(efTree));
  }
  let namesArr = doc.cos.resolveArray(dictGet(efTree, "Names"));
  if (!namesArr) {
    namesArr = cosArray([]);
    dictSet(efTree, "Names", namesArr);
  }
  const targetPageIdx =
    toPageSpec !== undefined && doc.pageCount > 0
      ? toPageSpec.toLowerCase() === "end"
        ? doc.pageCount - 1
        : Math.max(0, Math.min(doc.pageCount - 1, (Number.parseInt(toPageSpec, 10) || 1) - 1))
      : undefined;

  for (const fp of filePaths) {
    const bytes = files.get(fp);
    if (!bytes) continue;
    const baseName = fp.slice(fp.lastIndexOf("/") + 1);
    const efStreamRef = doc.cos.allocateObject(
      cosStream(bytes, {
        dict: cosDict({ Type: cosName("EmbeddedFile") }),
        compress: true,
      })
    );
    const filespecRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        F: cosString(baseName),
        UF: cosString(baseName),
        EF: cosDict({ F: efStreamRef }),
      })
    );
    namesArr.items.push(cosString(baseName), filespecRef);

    if (targetPageIdx !== undefined) {
      const pageDict = doc.getPage(targetPageIdx).pageDict;
      let annotsArr = doc.cos.resolveArray(dictGet(pageDict, "Annots"));
      if (!annotsArr) {
        annotsArr = cosArray([]);
        dictSet(pageDict, "Annots", annotsArr);
      }
      const annotRef = doc.cos.allocateObject(
        cosDict({
          Type: cosName("Annot"),
          Subtype: cosName("FileAttachment"),
          Name: cosName("PushPin"),
          Contents: cosString(baseName),
          FS: filespecRef,
          Rect: cosArray([cosNumber(20), cosNumber(20), cosNumber(40), cosNumber(40)]),
        })
      );
      annotsArr.items.push(annotRef);
    }
  }
}

function unpackFilesFromDocument(
  doc: PdfDocument,
  outDir: string,
  files: Map<string, Uint8Array>
): void {
  const cleanDir = outDir.endsWith("/") ? outDir.slice(0, -1) : outDir;
  const writeSpecDict = (specDict: PdfCosDict, fallbackName = "attachment.bin") => {
    const ufNode = doc.cos.resolve(dictGet(specDict, "UF") ?? dictGet(specDict, "F"));
    const fileName = ufNode?.kind === "string" ? decodePdfString(ufNode) : fallbackName;
    const efDict = doc.cos.resolveDict(dictGet(specDict, "EF"));
    const fStream = efDict
      ? doc.cos.resolve(
          dictGet(efDict, "UF") ??
            dictGet(efDict, "F") ??
            dictGet(efDict, "DOS") ??
            dictGet(efDict, "Mac") ??
            dictGet(efDict, "Unix")
        )
      : undefined;
    if (fStream?.kind === "stream") {
      const decoded = doc.cos.decodeStream(fStream);
      const targetPath = cleanDir && cleanDir !== "." ? `${cleanDir}/${fileName}` : fileName;
      files.set(targetPath, decoded);
    }
  };

  const catalog = doc.cos.resolveDict(doc.cos.rootRef);
  if (catalog) {
    const namesDict = doc.cos.resolveDict(dictGet(catalog, "Names"));
    const efPairs: Array<{ name: string; value: PdfCosNode }> = [];
    if (namesDict) {
      collectNameTreePairs(doc, dictGet(namesDict, "EmbeddedFiles"), efPairs);
    }
    for (const pair of efPairs) {
      const specDict = doc.cos.resolveDict(pair.value);
      if (specDict) {
        writeSpecDict(specDict, pair.name);
      }
    }
    const rootAfArr = doc.cos.resolveArray(dictGet(catalog, "AF"));
    if (rootAfArr) {
      for (const item of rootAfArr.items) {
        const specDict = doc.cos.resolveDict(item);
        if (specDict) writeSpecDict(specDict);
      }
    }
  }

  for (let p = 0; p < doc.pageCount; p++) {
    const pageAfArr = doc.cos.resolveArray(dictGet(doc.getPage(p).pageDict, "AF"));
    if (pageAfArr) {
      for (const item of pageAfArr.items) {
        const specDict = doc.cos.resolveDict(item);
        if (specDict) writeSpecDict(specDict);
      }
    }
    const annotsArr = doc.cos.resolveArray(dictGet(doc.getPage(p).pageDict, "Annots"));
    if (!annotsArr) continue;
    for (const item of annotsArr.items) {
      const annotDict = doc.cos.resolveDict(item);
      if (!annotDict) continue;
      const subNode = doc.cos.resolve(dictGet(annotDict, "Subtype"));
      if (subNode?.kind === "name" && subNode.decoded === "FileAttachment") {
        const specDict = doc.cos.resolveDict(dictGet(annotDict, "FS"));
        if (specDict) writeSpecDict(specDict);
      }
    }
  }
}

function formatBurstFilename(pattern: string, pageNum: number): string {
  let out = "";
  let replaced = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") {
      out += pattern[i]!;
      continue;
    }
    if (pattern[i + 1] === "%") {
      out += "%";
      i++;
      continue;
    }
    if (!replaced) {
      let j = i + 1;
      let zeroPad = false;
      if (pattern[j] === "0") {
        zeroPad = true;
        j++;
      }
      let widthStr = "";
      while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") {
        widthStr += pattern[j]!;
        j++;
      }
      if (pattern[j] === "d") {
        const width = widthStr ? Number.parseInt(widthStr, 10) : 1;
        out += zeroPad ? String(pageNum).padStart(width, "0") : String(pageNum);
        replaced = true;
        i = j;
        continue;
      }
    }
    out += "%";
  }
  return out;
}

function cloneCosSubgraphInto(
  srcDoc: PdfDocument,
  dstDoc: PdfDocument,
  node: PdfCosNode | undefined,
  memo = new Map<number, PdfCosRef>()
): PdfCosNode | undefined {
  if (!node) return undefined;
  if (node.kind === "ref") {
    const cached = memo.get(node.objectNumber);
    if (cached) return cached;
    const placeholder = dstDoc.cos.allocateObject(cosDict({}));
    memo.set(node.objectNumber, placeholder);
    const resolved = srcDoc.cos.resolve(node);
    const cloned = cloneCosSubgraphInto(srcDoc, dstDoc, resolved, memo);
    if (cloned) {
      dstDoc.cos.objects.set(placeholder.objectNumber, {
        objectNumber: placeholder.objectNumber,
        generationNumber: 0,
        value: cloned,
      });
    }
    return placeholder;
  }
  if (node.kind === "array") {
    return cosArray(node.items.map(it => cloneCosSubgraphInto(srcDoc, dstDoc, it, memo)!).filter(Boolean));
  }
  if (node.kind === "dict") {
    const next = cosDict({});
    for (const entry of node.entries) {
      if (entry.key.decoded === "Parent") continue;
      const clonedVal = cloneCosSubgraphInto(srcDoc, dstDoc, entry.value, memo);
      if (clonedVal) dictSet(next, entry.key.decoded, clonedVal);
    }
    return next;
  }
  if (node.kind === "stream") {
    const clonedDict = cloneCosSubgraphInto(srcDoc, dstDoc, node.dict, memo) as PdfCosDict;
    return {
      kind: "stream",
      dict: clonedDict,
      rawBytes: new Uint8Array(node.rawBytes),
    };
  }
  return node;
}

function isPdfNameBodyChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    ch === "_" ||
    ch === "." ||
    ch === "+" ||
    ch === "-"
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

function rewritePdfResourceNames(text: string, renames: ReadonlyMap<string, string>): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "/") {
      let end = i + 1;
      while (end < text.length && isPdfNameBodyChar(text[end]!)) {
        end++;
      }
      const name = text.slice(i + 1, end);
      const mapped = renames.get(name);
      if (mapped) {
        out += `/${mapped}`;
        i = end;
        continue;
      }
    }
    out += text[i]!;
    i++;
  }
  return out;
}

function applyOverlayToDocument(
  targetDoc: PdfDocument,
  overlayDoc: PdfDocument,
  mode: "background" | "stamp",
  multi: boolean
): void {
  if (overlayDoc.pageCount === 0) return;
  const memo = new Map<number, PdfCosRef>();

  for (let i = 0; i < targetDoc.pageCount; i++) {
    const dstPage = targetDoc.getPage(i);
    const srcIdx = multi ? Math.min(i, overlayDoc.pageCount - 1) : 0;
    const srcPage = overlayDoc.getPage(srcIdx);

    const dstRes = dstPage.getResourcesDict();
    const srcRes = srcPage.getResourcesDict();
    const renamedResources = new Map<string, string>();
    for (const subKey of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties"]) {
      const srcSub = overlayDoc.cos.resolveDict(dictGet(srcRes, subKey));
      if (!srcSub) continue;
      let dstSub = targetDoc.cos.resolveDict(dictGet(dstRes, subKey));
      if (!dstSub) {
        dstSub = cosDict({});
        dictSet(dstRes, subKey, dstSub);
      }
      for (const entry of srcSub.entries) {
        const origKey = entry.key.decoded;
        const cloned = cloneCosSubgraphInto(overlayDoc, targetDoc, entry.value, memo);
        if (!cloned) continue;
        if (!dictGet(dstSub, origKey)) {
          dictSet(dstSub, origKey, cloned);
        } else {
          let newKey = `Ov_${i}_${origKey}`;
          let suffix = 1;
          while (dictGet(dstSub, newKey)) {
            newKey = `Ov_${i}_${suffix++}_${origKey}`;
          }
          dictSet(dstSub, newKey, cloned);
          renamedResources.set(origKey, newKey);
        }
      }
    }

    const srcContents = dictGet(srcPage.pageDict, "Contents");
    if (!srcContents) continue;
    const rawSrcNodes: PdfCosNode[] = [];
    const resolvedSrcContents = overlayDoc.cos.resolve(srcContents);
    if (resolvedSrcContents?.kind === "array") {
      rawSrcNodes.push(...resolvedSrcContents.items);
    } else {
      rawSrcNodes.push(srcContents);
    }

    const srcList: PdfCosNode[] = [];
    for (const sNode of rawSrcNodes) {
      const resolvedStream = overlayDoc.cos.resolve(sNode);
      if (resolvedStream?.kind === "stream" && renamedResources.size > 0) {
        const rawText = bytesToIso88591(overlayDoc.cos.decodeStream(resolvedStream));
        const text = rewritePdfResourceNames(rawText, renamedResources);
        srcList.push(
          targetDoc.cos.allocateObject(
            cosStream(iso88591ToBytes(text), { compress: false })
          )
        );
      } else {
        const cloned = cloneCosSubgraphInto(overlayDoc, targetDoc, sNode, memo);
        if (cloned) srcList.push(cloned);
      }
    }
    if (srcList.length === 0) continue;

    const dstContents = dictGet(dstPage.pageDict, "Contents");
    const toStreamList = (c: PdfCosNode | undefined): PdfCosNode[] => {
      if (!c) return [];
      const r = targetDoc.cos.resolve(c);
      if (r?.kind === "array") return [...r.items];
      return [c];
    };
    const dstList = toStreamList(dstContents);
    const dstSize = dstPage.getSize();
    const srcSize = srcPage.getSize();
    const rotDiff = (((dstPage.getRotation() - srcPage.getRotation()) % 360) + 360) % 360;
    let srcOpenCmd = "q\n";
    if (srcSize.width > 0 && srcSize.height > 0) {
      const fmt6 = (n: number) => Number(n.toFixed(6));
      const fmt4 = (n: number) => Number(n.toFixed(4));
      if (rotDiff === 90) {
        const s = Math.min(dstSize.height / srcSize.width, dstSize.width / srcSize.height);
        const ox = (dstSize.height - srcSize.width * s) / 2;
        const oy = (dstSize.width - srcSize.height * s) / 2;
        srcOpenCmd = `q\n0 ${fmt6(s)} ${fmt6(-s)} 0 ${fmt4(dstSize.width - oy)} ${fmt4(ox)} cm\n`;
      } else if (rotDiff === 180) {
        const s = Math.min(dstSize.width / srcSize.width, dstSize.height / srcSize.height);
        const ox = (dstSize.width - srcSize.width * s) / 2;
        const oy = (dstSize.height - srcSize.height * s) / 2;
        srcOpenCmd = `q\n${fmt6(-s)} 0 0 ${fmt6(-s)} ${fmt4(dstSize.width - ox)} ${fmt4(dstSize.height - oy)} cm\n`;
      } else if (rotDiff === 270) {
        const s = Math.min(dstSize.height / srcSize.width, dstSize.width / srcSize.height);
        const ox = (dstSize.height - srcSize.width * s) / 2;
        const oy = (dstSize.width - srcSize.height * s) / 2;
        srcOpenCmd = `q\n0 ${fmt6(-s)} ${fmt6(s)} 0 ${fmt4(oy)} ${fmt4(dstSize.height - ox)} cm\n`;
      } else if (Math.abs(srcSize.width - dstSize.width) > 0.5 || Math.abs(srcSize.height - dstSize.height) > 0.5) {
        const s = Math.min(dstSize.width / srcSize.width, dstSize.height / srcSize.height);
        const tx = (dstSize.width - srcSize.width * s) / 2;
        const ty = (dstSize.height - srcSize.height * s) / 2;
        srcOpenCmd = `q\n${fmt6(s)} 0 0 ${fmt6(s)} ${fmt4(tx)} ${fmt4(ty)} cm\n`;
      }
    }
    const qOpenDst = targetDoc.cos.allocateObject(cosStream(new TextEncoder().encode("q\n"), { compress: false }));
    const qOpenSrc = targetDoc.cos.allocateObject(cosStream(new TextEncoder().encode(srcOpenCmd), { compress: false }));
    const qClose = targetDoc.cos.allocateObject(cosStream(new TextEncoder().encode("\nQ\n"), { compress: false }));
    const combined =
      mode === "background"
        ? [qOpenSrc, ...srcList, qClose, qOpenDst, ...dstList, qClose]
        : [qOpenDst, ...dstList, qClose, qOpenSrc, ...srcList, qClose];
    dictSet(dstPage.pageDict, "Contents", cosArray(combined));
  }
}

function normalizeQuarterTurn(degrees: number): 0 | 90 | 180 | 270 {
  const mod = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  if (mod === 90 || mod === 180 || mod === 270) return mod;
  return 0;
}

export async function runPdftkCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<PdftkCliResult> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return {
      exitCode: 0,
      stdout:
        "Usage: pdftk <input PDF files | [handle]=filename ...> [<operation> <operation arguments>] [output <output filename>] [flatten]\n",
      stderr: "",
    };
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    return { exitCode: 0, stdout: "pdftk port to Java 3.3.3 (safe-bash @poe-code/pdf-ast)\n", stderr: "" };
  }

  const inputPasswords = new Map<string, string>();
  let defaultInputPassword = "";
  for (let p = 0; p < argv.length; p++) {
    if (argv[p]?.toLowerCase() === "input_pw") {
      for (let q = p + 1; q < argv.length; q++) {
        const tok = argv[q]!;
        if (PDFTK_OPERATIONS.has(tok.toLowerCase())) break;
        const eq = tok.indexOf("=");
        if (eq > 0) inputPasswords.set(tok.slice(0, eq), tok.slice(eq + 1));
        else defaultInputPassword = tok;
      }
    }
  }

  const handles = new Map<string, PdfDocument>();
  const orderedDocs: Array<{ handle: string; doc: PdfDocument }> = [];
  let idx = 0;
  let autoHandleCharCode = 65;

  while (idx < argv.length) {
    const token = argv[idx]!;
    if (PDFTK_OPERATIONS.has(token.toLowerCase()) || token.toLowerCase() === "input_pw") break;
    idx++;

    let handleName = "";
    let filePath = token;
    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      handleName = token.slice(0, eqIdx);
      filePath = token.slice(eqIdx + 1);
    } else {
      handleName = String.fromCharCode(autoHandleCharCode++);
    }

    const pdfBytes = files.get(filePath);
    if (!pdfBytes) {
      return { exitCode: 1, stdout: "", stderr: `Error: Unable to find file '${filePath}'\n` };
    }
    const pw = inputPasswords.get(handleName) ?? defaultInputPassword;
    let doc: PdfDocument;
    try {
      doc = PdfDocument.load(pdfBytes, pw ? { password: pw } : undefined);
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: `Error: Failed to open PDF '${filePath}': ${(err as Error).message}\n` };
    }
    handles.set(handleName, doc);
    if (!handles.has("")) handles.set("", doc);
    orderedDocs.push({ handle: handleName, doc });
  }

  if (orderedDocs.length === 0) {
    return { exitCode: 1, stdout: "", stderr: "Error: No input PDF files specified.\n" };
  }

  while (idx < argv.length && argv[idx]?.toLowerCase() === "input_pw") {
    idx++;
    while (idx < argv.length && !PDFTK_OPERATIONS.has(argv[idx]!.toLowerCase())) {
      idx++;
    }
  }

  const primaryDoc = orderedDocs[0]!.doc;
  const primaryHandle = orderedDocs[0]!.handle;
  const operation = (argv[idx] ?? "cat").toLowerCase();
  idx++;

  const opArgs: string[] = [];
  let outputTarget: string | undefined;
  if (operation === "output") {
    outputTarget = argv[idx++];
  }
  let shouldFlatten = false;
  let needAppearances = false;
  let dropXfa = false;
  let dropXmp = false;
  let replacementFont: string | undefined;
  let keepFirstId = false;
  let keepFinalId = false;
  let uncompressStreams = false;
  let compressStreams = false;
  let userPassword: string | undefined;
  let ownerPassword: string | undefined;
  const allowPermissions = new Set<string>();
  const ALLOW_KEYWORDS = new Set([
    "printing",
    "degradedprinting",
    "modifycontents",
    "assembly",
    "copycontents",
    "screenreaders",
    "modifyannotations",
    "fillin",
    "allfeatures"
  ]);

  while (idx < argv.length) {
    const tok = argv[idx++]!;
    const lower = tok.toLowerCase();
    if (lower === "output") {
      outputTarget = argv[idx++];
    } else if (lower === "flatten") {
      shouldFlatten = true;
    } else if (lower === "need_appearances") {
      needAppearances = true;
    } else if (lower === "user_pw") {
      userPassword = argv[idx++];
    } else if (lower === "owner_pw") {
      ownerPassword = argv[idx++];
    } else if (lower === "allow") {
      while (idx < argv.length && ALLOW_KEYWORDS.has(argv[idx]!.toLowerCase())) {
        allowPermissions.add(argv[idx++]!.toLowerCase());
      }
    } else if (lower === "keep_first_id") {
      keepFirstId = true;
    } else if (lower === "keep_final_id") {
      keepFinalId = true;
    } else if (lower === "uncompress") {
      uncompressStreams = true;
    } else if (lower === "compress") {
      compressStreams = true;
    } else if (
      lower === "dont_ask" ||
      lower === "do_ask" ||
      lower === "encrypt_128bit" ||
      lower === "encrypt_40bit" ||
      lower === "verbose"
    ) {
      // Standard PDFtk flags
    } else if (lower === "drop_xfa") {
      dropXfa = true;
    } else if (lower === "drop_xmp") {
      dropXmp = true;
    } else if (lower === "replacement_font") {
      replacementFont = argv[idx++];
    } else {
      opArgs.push(tok);
    }
  }

  if (operation === "dump_data_fields" || operation === "dump_data_fields_utf8") {
    const text = formatDumpDataFields(primaryDoc, operation === "dump_data_fields_utf8");
    if (outputTarget && outputTarget !== "-") {
      files.set(outputTarget, new TextEncoder().encode(text));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: text, stderr: "" };
  }

  if (operation === "dump_data" || operation === "dump_data_utf8") {
    const text = formatDumpData(primaryDoc, operation === "dump_data_utf8");
    if (outputTarget && outputTarget !== "-") {
      files.set(outputTarget, new TextEncoder().encode(text));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: text, stderr: "" };
  }

  if (operation === "dump_data_annots" || operation === "dump_data_annots_utf8") {
    const text = formatDumpDataAnnots(primaryDoc, operation === "dump_data_annots_utf8");
    if (outputTarget && outputTarget !== "-") {
      files.set(outputTarget, new TextEncoder().encode(text));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: text, stderr: "" };
  }

  if (operation === "burst") {
    const pattern = outputTarget ?? "pg_%04d.pdf";
    for (let p = 1; p <= primaryDoc.pageCount; p++) {
      const singleDoc = PdfDocument.create();
      copyPrimaryMetadata(primaryDoc, singleDoc);
      singleDoc.copyPagesFrom(primaryDoc, [p - 1]);
      if (shouldFlatten) {
        flattenDocumentFormFields(singleDoc.cos);
      }
      if (uncompressStreams || compressStreams) {
        for (const obj of singleDoc.cos.objects.values()) {
          if (obj.value.kind !== "stream") continue;
          const raw = singleDoc.cos.decodeStream(obj.value);
          dictDelete(obj.value.dict, "Filter");
          dictDelete(obj.value.dict, "DecodeParms");
          singleDoc.cos.objects.set(obj.objectNumber, {
            ...obj,
            value: cosStream(raw, {
              dict: obj.value.dict,
              compress: !uncompressStreams && compressStreams
            })
          });
        }
      }
      const outName = formatBurstFilename(pattern, p);
      files.set(outName, singleDoc.save());
    }
    const lastSlash = pattern.lastIndexOf("/");
    const docDataPath = lastSlash !== -1 ? `${pattern.slice(0, lastSlash + 1)}doc_data.txt` : "doc_data.txt";
    files.set(docDataPath, new TextEncoder().encode(formatDumpData(primaryDoc)));
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  if (operation === "generate_fdf") {
    const fdfText = formatGenerateFdf(primaryDoc);
    if (outputTarget && outputTarget !== "-") {
      files.set(outputTarget, new TextEncoder().encode(fdfText));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: fdfText, stderr: "" };
  }

  if (operation === "unpack_files") {
    unpackFilesFromDocument(primaryDoc, outputTarget ?? ".", files);
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  let resultDoc = primaryDoc;

  if (operation === "update_info" || operation === "update_info_utf8") {
    const infoFile = opArgs[0] ?? "-";
    const infoBytes = files.get(infoFile);
    if (!infoBytes) {
      return { exitCode: 1, stdout: "", stderr: `Error: Unable to open info file '${infoFile}'\n` };
    }
    applyUpdateInfoText(resultDoc, new TextDecoder().decode(infoBytes));
  } else if (operation === "attach_files") {
    const filesToAttach: string[] = [];
    let toPageSpec: string | undefined;
    for (let k = 0; k < opArgs.length; k++) {
      if (opArgs[k]?.toLowerCase() === "to_page") {
        toPageSpec = opArgs[++k];
        continue;
      }
      filesToAttach.push(opArgs[k]!);
    }
    attachFilesToDocument(resultDoc, filesToAttach, files, toPageSpec);
  } else if (operation === "fill_form") {
    const dataFile = opArgs[0] ?? "-";
    const dataBytes = files.get(dataFile);
    if (!dataBytes) {
      return { exitCode: 1, stdout: "", stderr: `Error: Unable to open form data file '${dataFile}'\n` };
    }
    const fieldValues = parseFormDataBytes(dataBytes);
    for (const [k, v] of fieldValues.entries()) {
      setDocumentFormField(resultDoc.cos, k, v);
    }
    if (shouldFlatten) {
      flattenDocumentFormFields(resultDoc.cos);
    }
  } else if (operation === "flatten") {
    flattenDocumentFormFields(resultDoc.cos);
  } else if (operation === "cat" || operation === "shuffle") {
    resultDoc = PdfDocument.create();
    copyPrimaryMetadata(primaryDoc, resultDoc);
    const selections: ExpandedPageSelection[] = [];
    if (opArgs.length === 0) {
      for (const item of orderedDocs) {
        for (let p = 1; p <= item.doc.pageCount; p++) {
          selections.push({ handle: item.handle, pageNumber: p });
        }
      }
    } else if (operation === "shuffle") {
      const groups = opArgs.map(arg => parsePdftkRangeToken(arg, handles, primaryHandle));
      const maxLen = Math.max(0, ...groups.map(g => g.length));
      for (let k = 0; k < maxLen; k++) {
        for (const g of groups) {
          if (k < g.length) selections.push(g[k]!);
        }
      }
    } else {
      for (const arg of opArgs) {
        selections.push(...parsePdftkRangeToken(arg, handles, primaryHandle));
      }
    }

    const bookmarksByDoc = new Map<PdfDocument, Array<{ title: string; level: number; pageNumber: number }>>();
    const getDocBookmarks = (d: PdfDocument) => {
      let cached = bookmarksByDoc.get(d);
      if (!cached) {
        cached = [];
        const cat = d.cos.resolveDict(d.cos.rootRef);
        const outDict = cat ? d.cos.resolveDict(dictGet(cat, "Outlines")) : undefined;
        if (outDict) {
          collectOutlineBookmarks(d, dictGet(outDict, "First"), 1, cached);
        }
        bookmarksByDoc.set(d, cached);
      }
      return cached;
    };
    const remappedBookmarks: Array<{ title: string; level: number; pageNumber: number }> = [];

    for (let sIdx = 0; sIdx < selections.length; sIdx++) {
      const sel = selections[sIdx]!;
      const srcDoc = handles.get(sel.handle) ?? primaryDoc;
      const [copied] = resultDoc.copyPagesFrom(srcDoc, [sel.pageNumber - 1]);
      if (copied && sel.rotation) {
        const currentRot = copied.getRotation();
        const rawRot =
          sel.rotation.kind === "absolute"
            ? sel.rotation.degrees
            : currentRot + sel.rotation.degrees;
        copied.setRotation(normalizeQuarterTurn(rawRot));
      }
      for (const bm of getDocBookmarks(srcDoc)) {
        if (bm.pageNumber === sel.pageNumber) {
          remappedBookmarks.push({
            title: bm.title,
            level: bm.level,
            pageNumber: sIdx + 1,
          });
        }
      }
    }
    setDocumentBookmarks(resultDoc, remappedBookmarks);
    const usedDocs = new Set<PdfDocument>();
    for (const sel of selections) {
      const d = handles.get(sel.handle) ?? primaryDoc;
      usedDocs.add(d);
    }
    const unpackedMap = new Map<string, Uint8Array>();
    for (const d of usedDocs) {
      unpackFilesFromDocument(d, ".", unpackedMap);
    }
    if (unpackedMap.size > 0) {
      attachFilesToDocument(resultDoc, [...unpackedMap.keys()], unpackedMap);
    }
    if (shouldFlatten) {
      flattenDocumentFormFields(resultDoc.cos);
    }
  } else if (operation === "rotate") {
    const rotByPage = new Map<number, RotationSpec>();
    for (const arg of opArgs) {
      for (const sel of parsePdftkRangeToken(arg, handles, primaryHandle)) {
        if (sel.rotation) rotByPage.set(sel.pageNumber, sel.rotation);
      }
    }
    for (let p = 1; p <= resultDoc.pageCount; p++) {
      const spec = rotByPage.get(p);
      if (spec) {
        const page = resultDoc.getPage(p - 1);
        const rawRot =
          spec.kind === "absolute"
            ? spec.degrees
            : page.getRotation() + spec.degrees;
        page.setRotation(normalizeQuarterTurn(rawRot));
      }
    }
  } else if (
    operation === "background" ||
    operation === "multibackground" ||
    operation === "stamp" ||
    operation === "multistamp"
  ) {
    const overlayPath = opArgs[0];
    const overlayBytes = overlayPath ? files.get(overlayPath) : undefined;
    if (!overlayBytes) {
      return { exitCode: 1, stdout: "", stderr: `Error: Unable to open '${overlayPath ?? ""}'\n` };
    }
    const overlayDoc = PdfDocument.load(overlayBytes);
    applyOverlayToDocument(
      resultDoc,
      overlayDoc,
      operation.includes("background") ? "background" : "stamp",
      operation.startsWith("multi")
    );
    if (shouldFlatten) {
      flattenDocumentFormFields(resultDoc.cos);
    }
  } else if (operation === "output") {
    if (shouldFlatten) {
      flattenDocumentFormFields(resultDoc.cos);
    }
  }

  if (dropXfa) {
    const root = resultDoc.cos.resolveDict(resultDoc.cos.rootRef);
    const acroForm = root ? resultDoc.cos.resolveDict(dictGet(root, "AcroForm")) : undefined;
    if (acroForm) dictDelete(acroForm, "XFA");
  }

  if (dropXmp) {
    const root = resultDoc.cos.resolveDict(resultDoc.cos.rootRef);
    if (root) dictDelete(root, "Metadata");
  }

  if (replacementFont && operation === "fill_form") {
    const cleanFontName = replacementFont.startsWith("/") ? replacementFont.slice(1) : replacementFont;
    for (const obj of resultDoc.cos.objects.values()) {
      if (obj.value.kind === "dict") {
        const stNode = dictGet(obj.value, "Subtype");
        const bfNode = dictGet(obj.value, "BaseFont");
        const subtype = stNode?.kind === "name" ? stNode.decoded : undefined;
        const baseFont = bfNode?.kind === "name" ? bfNode.decoded : undefined;
        if (subtype === "Type1" && baseFont === "Helvetica") {
          dictSet(obj.value, "BaseFont", cosName(cleanFontName));
        }
      }
    }
  }

  if (operation === "fill_form" && !shouldFlatten) {
    const root = resultDoc.cos.resolveDict(resultDoc.cos.rootRef);
    const acroForm = root ? resultDoc.cos.resolveDict(dictGet(root, "AcroForm")) : undefined;
    if (acroForm) {
      dictSet(acroForm, "NeedAppearances", { kind: "boolean", value: needAppearances });
    }
  } else if (needAppearances && !shouldFlatten) {
    const root = resultDoc.cos.resolveDict(resultDoc.cos.rootRef);
    if (root) {
      const acroForm = resultDoc.cos.resolveDict(dictGet(root, "AcroForm"));
      if (acroForm) {
        dictSet(acroForm, "NeedAppearances", { kind: "boolean", value: true });
      }
    }
  }

  const handleDocs = [...handles.values()];
  if (keepFinalId) {
    const lastInput = handleDocs[handleDocs.length - 1];
    if (lastInput?.cos.idArray) {
      resultDoc.cos.idArray = cosArray([...lastInput.cos.idArray.items]);
    }
  } else if (keepFirstId || !resultDoc.cos.idArray) {
    const firstInput = handleDocs[0];
    if (firstInput?.cos.idArray) {
      resultDoc.cos.idArray = cosArray([...firstInput.cos.idArray.items]);
    }
  }

  if (uncompressStreams || compressStreams) {
    for (const obj of resultDoc.cos.objects.values()) {
      if (obj.value.kind !== "stream") continue;
      const raw = resultDoc.cos.decodeStream(obj.value);
      dictDelete(obj.value.dict, "Filter");
      dictDelete(obj.value.dict, "DecodeParms");
      resultDoc.cos.objects.set(obj.objectNumber, {
        ...obj,
        value: cosStream(raw, {
          dict: obj.value.dict,
          compress: !uncompressStreams && compressStreams,
        }),
      });
    }
  }

  const hasAllow = allowPermissions.size > 0;
  const allAllowed = allowPermissions.has("allfeatures");
  const savedBytes = resultDoc.save(
    userPassword || ownerPassword
      ? {
          encrypt: {
            userPassword: userPassword ?? "",
            ownerPassword: ownerPassword ?? userPassword ?? "owner",
            revision: 6,
            ...(hasAllow
              ? {
                  permissions: {
                    print: allAllowed || allowPermissions.has("printing") || allowPermissions.has("degradedprinting"),
                    modify: allAllowed || allowPermissions.has("modifycontents"),
                    copy: allAllowed || allowPermissions.has("copycontents"),
                    addNotes: allAllowed || allowPermissions.has("modifyannotations"),
                    fillForms: allAllowed || allowPermissions.has("fillin") || allowPermissions.has("modifyannotations"),
                    extractAccessibility: allAllowed || allowPermissions.has("screenreaders"),
                    assemble: allAllowed || allowPermissions.has("assembly") || allowPermissions.has("modifycontents"),
                    printHighRes: allAllowed || allowPermissions.has("printing")
                  }
                }
              : {})
          }
        }
      : {}
  );
  if (!outputTarget || outputTarget === "-") {
    return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: savedBytes };
  }
  files.set(outputTarget, savedBytes);
  return { exitCode: 0, stdout: "", stderr: "" };
}

async function executePdftk(context: CommandContext): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
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

    if (argv.some((t, i) => (t === "-" || t.endsWith("=-")) && argv[i - 1]?.toLowerCase() !== "output")) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
        chargeBytes(chunk.byteLength);
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      vfsFiles.set("-", buf);
    }

    for (const token of argv) {
      if (token.startsWith("-") && token !== "-") continue;
      const eqIdx = token.indexOf("=");
      const filePath = eqIdx > 0 ? token.slice(eqIdx + 1) : token;
      if (filePath === "-") continue;
      try {
        const bytes = await context.fs.readFile(resolveVfsPath(filePath), { signal: invocation.signal });
        chargeBytes(bytes.byteLength);
        vfsFiles.set(filePath, bytes);
      } catch {
        // Non-existing output file or operation keyword
      }
    }

    const existingSnap = new Map(vfsFiles);
    const res = await runPdftkCli(argv, vfsFiles);
    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdoutBytes) {
      chargeBytes(res.stdoutBytes.byteLength);
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, res.stdoutBytes, invocation.signal);
    } else if (res.stdout) {
      const outBytes = new TextEncoder().encode(res.stdout);
      chargeBytes(outBytes.byteLength);
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, outBytes, invocation.signal);
    }
    for (const [key, val] of vfsFiles.entries()) {
      if (key !== "-" && existingSnap.get(key) !== val) {
        chargeBytes(val.byteLength);
        const abs = resolveVfsPath(key);
        const parentDir = abs.slice(0, abs.lastIndexOf("/")) || "/";
        try {
          await context.fs.mkdir(parentDir, { recursive: true, signal: invocation.signal });
        } catch {
          // Directory already exists
        }
        await context.fs.writeFile(abs, val, { signal: invocation.signal });
      }
    }
    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createPdftkCommand(_options: PdftkCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdftk",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Manipulate PDF documents, fill/flatten AcroForms, and assemble pages via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePdftk(context);
    },
  });
}

export const pdftkCommand: CommandDefinition = createPdftkCommand();

export function pdftkPlugin(options: PdftkCommandOptions = {}): VirtualShellPlugin {
  const cmd = createPdftkCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdftk",
    setup(host) {
      host.commands.register(cmd, { replace });
    },
  };
}

export const pdftkCommands = pdftkPlugin;
