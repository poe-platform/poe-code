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
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  dictGet,
  dictSet,
  decodePdfString,
  decodePng,
  encodePng,
  encodePpm,
  encodePgm,
  encodePbm,
  encodeJpeg,
  encodeTiff,
  renderPdfPageToBitmap,
  renderDisplayListToSvg,
  extractDocumentImages,
  parseContentStream,
  resolveDestinationPageIndex,
  type PdfCropRect,
  type PdfCosNode,
  type PdfCosDict,
  type ParsedCosDocument,
  type PdfPage
} from "@poe-code/pdf-ast";

export interface PdfinfoCommandOptions {
  readonly replace?: boolean;
}

export interface PdfinfoInspectionOptions {
  readonly fileSize?: number;
  readonly isStdin?: boolean;
}

export interface PdfinfoCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const SUPPORTED_ENCODINGS = new Set([
  "ASCII7",
  "Latin1",
  "UTF-8",
  "UCS-2",
  "Symbol",
  "ZapfDingbats"
]);

const STANDARD_INFO_KEYS = new Set([
  "Title",
  "Subject",
  "Keywords",
  "Author",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
  "Trapped"
]);

interface ParsedArgs {
  firstPage: number;
  lastPage: number;
  lastPageExplicit: boolean;
  box: boolean;
  meta: boolean;
  custom: boolean;
  js: boolean;
  struct: boolean;
  structText: boolean;
  isodates: boolean;
  rawdates: boolean;
  dests: boolean;
  url: boolean;
  encoding: string;
  listenc: boolean;
  upw?: string;
  opw?: string;
  version: boolean;
  help: boolean;
  inputFile?: string;
  error?: string;
  errorExitCode?: number;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const res: ParsedArgs = {
    firstPage: 1,
    lastPage: 0,
    lastPageExplicit: false,
    box: false,
    meta: false,
    custom: false,
    js: false,
    struct: false,
    structText: false,
    isodates: false,
    rawdates: false,
    dests: false,
    url: false,
    encoding: "UTF-8",
    listenc: false,
    version: false,
    help: false
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-f") {
      const next = argv[++i];
      const val = Number.parseInt(next ?? "", 10);
      if (!Number.isFinite(val)) {
        res.error = "Invalid -f page number\n";
        res.errorExitCode = 99;
        return res;
      }
      res.firstPage = val;
    } else if (arg === "-l") {
      const next = argv[++i];
      const val = Number.parseInt(next ?? "", 10);
      if (!Number.isFinite(val)) {
        res.error = "Invalid -l page number\n";
        res.errorExitCode = 99;
        return res;
      }
      res.lastPage = val;
      res.lastPageExplicit = true;
    } else if (arg === "-box") {
      res.box = true;
    } else if (arg === "-meta") {
      res.meta = true;
    } else if (arg === "-custom") {
      res.custom = true;
    } else if (arg === "-js") {
      res.js = true;
    } else if (arg === "-struct") {
      res.struct = true;
    } else if (arg === "-struct-text") {
      res.struct = true;
      res.structText = true;
    } else if (arg === "-isodates") {
      res.isodates = true;
    } else if (arg === "-rawdates") {
      res.rawdates = true;
    } else if (arg === "-dests") {
      res.dests = true;
    } else if (arg === "-url") {
      res.url = true;
    } else if (arg === "-enc") {
      const next = argv[++i];
      if (!next || !SUPPORTED_ENCODINGS.has(next)) {
        res.error = `Command Line Error: Unknown encoding '${next ?? ""}'\n`;
        res.errorExitCode = 99;
        return res;
      }
      res.encoding = next;
    } else if (arg === "-listenc") {
      res.listenc = true;
    } else if (arg === "-upw") {
      res.upw = argv[++i] ?? "";
    } else if (arg === "-opw") {
      res.opw = argv[++i] ?? "";
    } else if (arg === "-v" || arg === "--version") {
      res.version = true;
    } else if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      res.help = true;
    } else if (arg.startsWith("-") && arg !== "-") {
      res.error = `Command Line Error: Unknown option '${arg}'\n`;
      res.errorExitCode = 99;
      return res;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    res.error = "Usage: pdfinfo [options] [PDF-file]\n";
    res.errorExitCode = 99;
    return res;
  }
  res.inputFile = positional[0] ?? "-";
  return res;
}

function sanitizeControls(value: string, preserveLf = false): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (preserveLf && code === 0x0a) {
      out += "\n";
      continue;
    }
    if (
      code === 0x07 ||
      code === 0x08 ||
      code === 0x0a ||
      code === 0x0b ||
      code === 0x0c ||
      code === 0x0d ||
      code === 0x0e ||
      code === 0x0f ||
      code === 0x1b ||
      code === 0x7f
    ) {
      out += "?";
    } else {
      out += value[i]!;
    }
  }
  return out;
}

function formatField(label: string, value: string): string {
  const prefix = `${label}:`;
  const pad = Math.max(1, 16 - [...prefix].length);
  return `${prefix}${" ".repeat(pad)}${sanitizeControls(value)}\n`;
}

function isAsciiDigitChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x30 && c <= 0x39;
}

function takeDigitPair(str: string, pos: number): [string | undefined, number] {
  if (pos + 2 <= str.length && isAsciiDigitChar(str[pos]) && isAsciiDigitChar(str[pos + 1])) {
    return [str.slice(pos, pos + 2), pos + 2];
  }
  return [undefined, pos];
}

function formatPdfDate(raw: string, mode: "normal" | "iso" | "raw"): string {
  if (mode === "raw") return sanitizeControls(raw);
  const trimmed = raw.startsWith("D:") ? raw.slice(2) : raw;
  if (
    trimmed.length < 4 ||
    !isAsciiDigitChar(trimmed[0]) ||
    !isAsciiDigitChar(trimmed[1]) ||
    !isAsciiDigitChar(trimmed[2]) ||
    !isAsciiDigitChar(trimmed[3])
  ) {
    return sanitizeControls(raw);
  }

  const year = trimmed.slice(0, 4);
  let pos = 4;
  let month = "01";
  let day = "01";
  let hour = "00";
  let minute = "00";
  let second = "00";
  let tzSign: string | undefined;
  let tzHour = "00";
  let tzMin = "00";

  const [mPair, p1] = takeDigitPair(trimmed, pos);
  if (mPair) {
    month = mPair;
    pos = p1;
    const [dPair, p2] = takeDigitPair(trimmed, pos);
    if (dPair) {
      day = dPair;
      pos = p2;
      const [hPair, p3] = takeDigitPair(trimmed, pos);
      if (hPair) {
        hour = hPair;
        pos = p3;
        const [minPair, p4] = takeDigitPair(trimmed, pos);
        if (minPair) {
          minute = minPair;
          pos = p4;
          const [sPair, p5] = takeDigitPair(trimmed, pos);
          if (sPair) {
            second = sPair;
            pos = p5;
          }
        }
      }
    }
  }

  const signChar = trimmed[pos];
  if (signChar === "Z" || signChar === "z" || signChar === "+" || signChar === "-") {
    tzSign = signChar;
    pos++;
    const [tzhPair, pt1] = takeDigitPair(trimmed, pos);
    if (tzhPair) {
      tzHour = tzhPair;
      pos = pt1;
      if (trimmed[pos] === "'") pos++;
      const [tzmPair, pt2] = takeDigitPair(trimmed, pos);
      if (tzmPair) {
        tzMin = tzmPair;
        pos = pt2;
      }
    }
  }

  if (mode === "iso") {
    let suffix = "";
    if (!tzSign || tzSign === "Z" || tzSign === "z" || (tzHour === "00" && tzMin === "00")) {
      suffix = "Z";
    } else if (tzMin === "00") {
      suffix = `${tzSign}${tzHour}`;
    } else {
      suffix = `${tzSign}${tzHour}:${tzMin}`;
    }
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${suffix}`;
  }

  const utcMs = Date.UTC(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10)
  );
  if (Number.isNaN(utcMs)) return sanitizeControls(raw);
  let offsetSec = 0;
  if (tzSign === "+" || tzSign === "-") {
    offsetSec = (Number.parseInt(tzHour, 10) * 3600 + Number.parseInt(tzMin, 10) * 60) * (tzSign === "+" ? 1 : -1);
  }
  const dateObj = new Date(utcMs - offsetSec * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dName = days[dateObj.getUTCDay()] ?? "Mon";
  const mName = months[dateObj.getUTCMonth()] ?? "Jan";
  const dNum = String(dateObj.getUTCDate()).padStart(2, " ");
  const hh = String(dateObj.getUTCHours()).padStart(2, "0");
  const mm = String(dateObj.getUTCMinutes()).padStart(2, "0");
  const ss = String(dateObj.getUTCSeconds()).padStart(2, "0");
  const yyyy = String(dateObj.getUTCFullYear());
  return `${dName} ${mName} ${dNum} ${hh}:${mm}:${ss} ${yyyy} UTC`;
}

function paperSizeLabel(width: number, height: number): string {
  const candidates: Array<{ name: string; w: number; h: number; tolPt?: number; tolPct?: number }> =
    [
      { name: "letter", w: 612, h: 792, tolPt: 1.0 },
      { name: "A0", w: 2383.94, h: 3370.39, tolPct: 0.003 },
      { name: "A1", w: 1683.78, h: 2383.94, tolPct: 0.003 },
      { name: "A2", w: 1190.55, h: 1683.78, tolPct: 0.003 },
      { name: "A3", w: 841.89, h: 1190.55, tolPct: 0.003 },
      { name: "A4", w: 595.28, h: 841.89, tolPct: 0.003 },
      { name: "A5", w: 419.53, h: 595.28, tolPct: 0.003 },
      { name: "A6", w: 297.64, h: 419.53, tolPct: 0.003 }
    ];

  for (const c of candidates) {
    const matchDirect =
      c.tolPt !== undefined
        ? Math.abs(width - c.w) <= c.tolPt && Math.abs(height - c.h) <= c.tolPt
        : Math.abs(width - c.w) <= c.w * (c.tolPct ?? 0.003) &&
          Math.abs(height - c.h) <= c.h * (c.tolPct ?? 0.003);
    const matchSwapped =
      c.tolPt !== undefined
        ? Math.abs(width - c.h) <= c.tolPt && Math.abs(height - c.w) <= c.tolPt
        : Math.abs(width - c.h) <= c.h * (c.tolPct ?? 0.003) &&
          Math.abs(height - c.w) <= c.w * (c.tolPct ?? 0.003);
    if (matchDirect || matchSwapped) return ` (${c.name})`;
  }
  return "";
}

function formatNumTrimmed(n: number): string {
  const fixed = Number(n.toFixed(2));
  return Number.isInteger(fixed) ? String(fixed) : fixed.toString();
}

function formatBox8(box: [number, number, number, number]): string {
  return box.map((v) => v.toFixed(2).padStart(8, " ")).join(" ");
}

function resolvePageBox(
  cos: ParsedCosDocument,
  page: PdfPage,
  key: "MediaBox" | "CropBox" | "BleedBox" | "TrimBox" | "ArtBox",
  fallback: [number, number, number, number]
): [number, number, number, number] {
  let cur: PdfCosDict | undefined = page.pageDict;
  const visited = new Set<PdfCosDict>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const arr = cos.resolveArray(dictGet(cur, key));
    if (arr && arr.items.length >= 4) {
      const n0 = cos.resolve(arr.items[0]);
      const n1 = cos.resolve(arr.items[1]);
      const n2 = cos.resolve(arr.items[2]);
      const n3 = cos.resolve(arr.items[3]);
      if (
        n0?.kind === "number" &&
        n1?.kind === "number" &&
        n2?.kind === "number" &&
        n3?.kind === "number"
      ) {
        return [n0.value, n1.value, n2.value, n3.value];
      }
    }
    cur = cos.resolveDict(dictGet(cur, "Parent"));
  }
  return fallback;
}

function collectJavaScriptActions(cos: ParsedCosDocument): Array<{ name: string; js: string }> {
  const actions: Array<{ name: string; js: string }> = [];
  const root = cos.resolveDict(cos.rootRef);
  if (!root) return actions;

  const visitedActions = new Set<PdfCosDict>();
  const extractJsFromAction = (actionNode: PdfCosNode | undefined, label: string, depth = 0) => {
    if (!actionNode || depth > 8) return;
    const resolved = cos.resolve(actionNode);
    if (resolved?.kind === "array") {
      for (const item of resolved.items) {
        extractJsFromAction(item, label, depth + 1);
      }
      return;
    }
    const d = cos.resolveDict(actionNode);
    if (!d || visitedActions.has(d)) return;
    visitedActions.add(d);
    const s = cos.resolve(dictGet(d, "S"));
    if (s?.kind === "name" && s.decoded === "JavaScript") {
      const jsVal = cos.resolve(dictGet(d, "JS"));
      if (jsVal?.kind === "string") {
        actions.push({ name: label, js: decodePdfString(jsVal) });
      } else if (jsVal?.kind === "stream") {
        actions.push({
          name: label,
          js: new TextDecoder().decode(cos.decodeStream(jsVal))
        });
      }
    }
    const nextNode = dictGet(d, "Next");
    if (nextNode) {
      extractJsFromAction(nextNode, label, depth + 1);
    }
  };

  const extractAaDict = (aaNode: PdfCosNode | undefined, prefix: string) => {
    const aaDict = cos.resolveDict(aaNode);
    if (!aaDict) return;
    for (const entry of aaDict.entries) {
      extractJsFromAction(entry.value, `${prefix} AA/${entry.key.decoded}`);
    }
  };

  extractJsFromAction(dictGet(root, "OpenAction"), "Document OpenAction");
  extractAaDict(dictGet(root, "AA"), "Document");

  // 1. /Names -> /JavaScript Name Tree
  const namesDict = cos.resolveDict(dictGet(root, "Names"));
  const jsTree = namesDict ? dictGet(namesDict, "JavaScript") : undefined;
  const visitedTree = new Set<PdfCosDict>();
  const walkJsNameTree = (node: PdfCosNode | undefined) => {
    const dict = cos.resolveDict(node);
    if (!dict || visitedTree.has(dict)) return;
    visitedTree.add(dict);
    const namesArr = cos.resolveArray(dictGet(dict, "Names"));
    if (namesArr) {
      for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
        const kNode = cos.resolve(namesArr.items[i]);
        const kStr =
          kNode?.kind === "string"
            ? decodePdfString(kNode)
            : kNode?.kind === "name"
              ? kNode.decoded
              : `Script${i / 2}`;
        extractJsFromAction(namesArr.items[i + 1], kStr);
      }
    }
    const kidsArr = cos.resolveArray(dictGet(dict, "Kids"));
    if (kidsArr) {
      for (const kid of kidsArr.items) walkJsNameTree(kid);
    }
  };
  walkJsNameTree(jsTree);

  // 2. Pages (/AA and /Annots)
  const visitedFieldOrAnnot = new Set<PdfCosDict>();
  const inspectFieldOrAnnot = (node: PdfCosNode | undefined, fallbackLabel: string) => {
    const dict = cos.resolveDict(node);
    if (!dict || visitedFieldOrAnnot.has(dict)) return;
    visitedFieldOrAnnot.add(dict);
    const tNode = cos.resolve(dictGet(dict, "T"));
    const label = tNode?.kind === "string" ? decodePdfString(tNode) : fallbackLabel;
    extractJsFromAction(dictGet(dict, "A"), `${label} Action`);
    extractAaDict(dictGet(dict, "AA"), label);
    const kidsArr = cos.resolveArray(dictGet(dict, "Kids"));
    if (kidsArr) {
      for (const kid of kidsArr.items) inspectFieldOrAnnot(kid, label);
    }
  };

  const pagesNode = dictGet(root, "Pages");
  let pageIdx = 1;
  const visitedPages = new Set<PdfCosDict>();
  const walkPages = (node: PdfCosNode | undefined) => {
    const d = cos.resolveDict(node);
    if (!d || visitedPages.has(d)) return;
    visitedPages.add(d);
    const typeNode = cos.resolve(dictGet(d, "Type"));
    const kids = cos.resolveArray(dictGet(d, "Kids"));
    if (kids && (typeNode?.kind !== "name" || typeNode.decoded !== "Page")) {
      for (const k of kids.items) walkPages(k);
    } else {
      const pLabel = `Page ${pageIdx++}`;
      extractAaDict(dictGet(d, "AA"), pLabel);
      const annotsArr = cos.resolveArray(dictGet(d, "Annots"));
      if (annotsArr) {
        annotsArr.items.forEach((annot, aIdx) => {
          inspectFieldOrAnnot(annot, `${pLabel} Annot ${aIdx + 1}`);
        });
      }
    }
  };
  walkPages(pagesNode);

  // 3. AcroForm /Fields
  const acroForm = cos.resolveDict(dictGet(root, "AcroForm"));
  const fieldsArr = acroForm ? cos.resolveArray(dictGet(acroForm, "Fields")) : undefined;
  if (fieldsArr) {
    fieldsArr.items.forEach((field, fIdx) => {
      inspectFieldOrAnnot(field, `Field ${fIdx + 1}`);
    });
  }

  return actions;
}

function extractPageMcidText(cos: ParsedCosDocument, pageDict: PdfCosDict, targetMcid: number): string {
  const contentsNode = cos.resolve(dictGet(pageDict, "Contents"));
  const streamChunks: Uint8Array[] = [];
  if (contentsNode?.kind === "stream") {
    streamChunks.push(cos.decodeStream(contentsNode));
  } else if (contentsNode?.kind === "array") {
    for (const item of contentsNode.items) {
      const s = cos.resolve(item);
      if (s?.kind === "stream") streamChunks.push(cos.decodeStream(s));
    }
  }
  if (streamChunks.length === 0) return "";
  const totalLen = streamChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const c of streamChunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  const resDict = cos.resolveDict(dictGet(pageDict, "Resources"));
  const propsDict = resDict ? cos.resolveDict(dictGet(resDict, "Properties")) : undefined;
  const ast = parseContentStream(merged);
  const parts: string[] = [];

  const extractTextCommands = (cmds: readonly import("@poe-code/pdf-ast").PdfTextCommand[]): string => {
    let s = "";
    for (const cmd of cmds) {
      if (cmd.kind === "show-text") {
        s += decodePdfString(cmd.token);
      } else if (cmd.kind === "show-text-array") {
        for (const it of cmd.items) {
          if (it.kind === "string") s += decodePdfString(it);
          else if (it.kind === "number" && it.value < -120) s += " ";
        }
      }
    }
    return s;
  };

  const walkNodes = (
    nodes: readonly import("@poe-code/pdf-ast").PdfContentNode[],
    inMatchingMcid: boolean
  ) => {
    for (const n of nodes) {
      if (n.kind === "graphics-group") {
        walkNodes(n.ops, inMatchingMcid);
      } else if (n.kind === "marked-content") {
        let matches = inMatchingMcid;
        const pDict =
          typeof n.properties === "string"
            ? propsDict
              ? cos.resolveDict(dictGet(propsDict, n.properties))
              : undefined
            : n.properties;
        if (pDict) {
          const mcidNode = cos.resolve(dictGet(pDict, "MCID"));
          if (mcidNode?.kind === "number") {
            matches = mcidNode.value === targetMcid;
          }
        }
        walkNodes(n.children, matches);
      } else if (n.kind === "text-object" && inMatchingMcid) {
        const t = extractTextCommands(n.commands);
        if (t.length > 0) parts.push(t);
      }
    }
  };
  walkNodes(ast, false);
  return parts.join(" ").trim();
}

function dumpStructTree(
  cos: ParsedCosDocument,
  node: PdfCosNode | undefined,
  includeText: boolean,
  indent = 0,
  roleMap?: Map<string, string>,
  inheritedPg?: PdfCosDict
): string {
  const deref = cos.resolve(node);
  if (!deref) return "";
  const pad = "  ".repeat(indent);
  let out = "";
  if (deref.kind === "array") {
    for (const item of deref.items) {
      out += dumpStructTree(cos, item, includeText, indent, roleMap, inheritedPg);
    }
    return out;
  }
  if (deref.kind === "dict") {
    let activeRoleMap = roleMap;
    if (!activeRoleMap) {
      activeRoleMap = new Map<string, string>();
      const rmDict = cos.resolveDict(dictGet(deref, "RoleMap"));
      if (rmDict) {
        for (const entry of rmDict.entries) {
          const target = cos.resolve(entry.value);
          if (target?.kind === "name") {
            activeRoleMap.set(entry.key.decoded, target.decoded);
          }
        }
      }
    }
    const typeNode = cos.resolve(dictGet(deref, "Type"));
    if (typeNode?.kind === "name" && typeNode.decoded === "MCR") {
      if (includeText) {
        const mcidNode = cos.resolve(dictGet(deref, "MCID"));
        const mcrPg = cos.resolveDict(dictGet(deref, "Pg")) ?? inheritedPg;
        if (mcidNode?.kind === "number" && mcrPg) {
          const mcidText = extractPageMcidText(cos, mcrPg, mcidNode.value);
          if (mcidText) out += `${pad}"${mcidText}"\n`;
        }
      }
      return out;
    }
    const sObj = cos.resolve(dictGet(deref, "S"));
    const role = sObj?.kind === "name" ? sObj.decoded : "StructTreeRoot";
    const mapped = activeRoleMap.get(role);
    out += mapped && mapped !== role ? `${pad}${role} / ${mapped}\n` : `${pad}${role}\n`;
    const currentPg = cos.resolveDict(dictGet(deref, "Pg")) ?? inheritedPg;
    if (includeText) {
      const actual = cos.resolve(dictGet(deref, "ActualText") ?? dictGet(deref, "Alt"));
      if (actual?.kind === "string") {
        const text = decodePdfString(actual);
        if (text) out += `${pad}  "${text}"\n`;
      }
    }
    const kids = dictGet(deref, "K");
    if (kids) {
      const resolvedK = cos.resolve(kids);
      if (resolvedK?.kind === "number") {
        if (includeText && currentPg) {
          const mcidText = extractPageMcidText(cos, currentPg, resolvedK.value);
          if (mcidText) out += `${pad}  "${mcidText}"\n`;
        }
      } else {
        out += dumpStructTree(cos, kids, includeText, indent + 1, activeRoleMap, currentPg);
      }
    }
  }
  return out;
}

function dumpDests(doc: PdfDocument, cos: ParsedCosDocument, firstPage = 1, lastPage = Number.MAX_SAFE_INTEGER): string {
  const root = cos.resolveDict(cos.rootRef);
  if (!root) return "";

  const collected: Array<{ name: string; value: PdfCosNode }> = [];
  const dests = cos.resolveDict(dictGet(root, "Dests"));
  if (dests) {
    for (const entry of dests.entries) {
      collected.push({ name: entry.key.decoded, value: entry.value });
    }
  }

  const namesDict = cos.resolveDict(dictGet(root, "Names"));
  const destsTree = namesDict ? dictGet(namesDict, "Dests") : undefined;
  const visitedTreeNodes = new Set<string>();
  const walkNameTree = (nodeRef: PdfCosNode | undefined) => {
    if (!nodeRef) return;
    if (nodeRef.kind === "ref") {
      const key = `${nodeRef.objectNumber}:${nodeRef.generationNumber}`;
      if (visitedTreeNodes.has(key)) return;
      visitedTreeNodes.add(key);
    }
    const dict = cos.resolveDict(nodeRef);
    if (!dict) return;
    const namesArr = cos.resolveArray(dictGet(dict, "Names"));
    if (namesArr) {
      for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
        const keyNode = cos.resolve(namesArr.items[i]);
        const valNode = namesArr.items[i + 1]!;
        const keyStr =
          keyNode?.kind === "string"
            ? decodePdfString(keyNode)
            : keyNode?.kind === "name"
              ? keyNode.decoded
              : undefined;
        if (keyStr !== undefined) {
          collected.push({ name: keyStr, value: valNode });
        }
      }
    }
    const kidsArr = cos.resolveArray(dictGet(dict, "Kids"));
    if (kidsArr) {
      for (const kid of kidsArr.items) {
        walkNameTree(kid);
      }
    }
  };
  walkNameTree(destsTree);

  if (collected.length === 0) return "";
  const pages = doc.getPages();
  let out = "Page  Destination                 Name\n";
  for (const { name, value } of collected) {
    const resolvedVal = cos.resolve(value);
    const arr =
      resolvedVal?.kind === "dict"
        ? cos.resolveArray(dictGet(resolvedVal, "D"))
        : cos.resolveArray(value);
    if (arr) {
      const targetPage = arr.items[0];
      let pageNum = 1;
      if (targetPage?.kind === "ref") {
        const idx = pages.findIndex(
          (p) =>
            p.ref.objectNumber === targetPage.objectNumber &&
            p.ref.generationNumber === targetPage.generationNumber
        );
        if (idx >= 0) pageNum = idx + 1;
      } else {
        const resolvedTarget = cos.resolve(targetPage);
        if (resolvedTarget?.kind === "number") {
          pageNum = Math.max(1, Math.floor(resolvedTarget.value) + 1);
        }
      }
      if (pageNum < firstPage || pageNum > lastPage) continue;
      const kindObj = cos.resolve(arr.items[1]);
      const kindName = kindObj?.kind === "name" ? kindObj.decoded : "XYZ";
      out += `${String(pageNum).padStart(4, " ")}  [${kindName.padEnd(24, " ")}] "${name}"\n`;
    }
  }
  return out;
}

function dumpUrls(doc: PdfDocument, cos: ParsedCosDocument, firstPage: number, lastPage: number): string {
  let out = "Page  Type          URL\n";
  for (let p = firstPage; p <= lastPage; p++) {
    const page = doc.getPage(p - 1);
    const annots = cos.resolveArray(dictGet(page.pageDict, "Annots"));
    if (annots) {
      for (const item of annots.items) {
        const annot = cos.resolveDict(item);
        if (!annot) continue;
        const walkActionUrls = (actNode: PdfCosNode | undefined, visited = new Set<PdfCosDict>()) => {
          const action = cos.resolveDict(actNode);
          if (!action || visited.has(action)) return;
          visited.add(action);
          const uri = cos.resolve(dictGet(action, "URI"));
          if (uri?.kind === "string") {
            out += `${String(p).padStart(4, " ")}  Annotation    ${decodePdfString(uri)}\n`;
          }
          const nextNode = cos.resolve(dictGet(action, "Next"));
          if (nextNode?.kind === "array") {
            for (const nextItem of nextNode.items) walkActionUrls(nextItem, visited);
          } else if (nextNode) {
            walkActionUrls(nextNode, visited);
          }
        };
        walkActionUrls(dictGet(annot, "A"));
      }
    }
  }
  return out;
}

function checkLinearized(cos: ParsedCosDocument): boolean {
  for (const obj of cos.objects.values()) {
    if (obj.value.kind === "dict" && dictGet(obj.value, "Linearized")) {
      return true;
    }
  }
  return false;
}


const ASCII7_COMPAT_MAP: Readonly<Record<string, string>> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": "\"",
  "\u201D": "\"",
  "\u2013": "-",
  "\u2014": "--",
  "\u2026": "...",
  "\u00A0": " "
};

function applyPopplerOutputEncoding(text: string, encoding: string): string {
  if (!encoding || encoding === "UTF-8" || encoding === "UCS-2") return text;
  if (encoding === "ASCII7") {
    let out = "";
    const normalized = text.normalize("NFKD");
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i]!;
      const mapped = ASCII7_COMPAT_MAP[ch];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code >= 0x0300 && code <= 0x036f) continue;
      if (code <= 0x7f) out += ch;
    }
    return out;
  }
  if (encoding === "Latin1") {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const mapped = ASCII7_COMPAT_MAP[ch];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code <= 0xff) out += ch;
    }
    return out;
  }
  return text;
}

export function inspectPdfBytes(
  bytes: Uint8Array,
  argv: readonly string[] = [],
  options: PdfinfoInspectionOptions = {}
): PdfinfoCliResult {
  const args = parseArgs(argv);
  if (args.error) {
    return { exitCode: args.errorExitCode ?? 99, stdout: "", stderr: args.error };
  }
  if (args.listenc) {
    return {
      exitCode: 0,
      stdout: `Available encodings are:\n${[...SUPPORTED_ENCODINGS].join("\n")}\n`,
      stderr: ""
    };
  }
  if (args.version) {
    return {
      exitCode: 0,
      stdout: "pdfinfo version 26.09.90 (@poe-code/pdf-ast)\n",
      stderr: ""
    };
  }
  if (args.help) {
    return {
      exitCode: 0,
      stdout:
        "Usage: pdfinfo [options] [PDF-file]\n  -f <int>       : first page to examine\n  -l <int>       : last page to examine\n  -box           : print the page bounding boxes\n  -meta          : print the document metadata (XML)\n  -custom        : print custom and standard metadata\n  -js            : print all JavaScript in the PDF\n  -struct        : print the logical document structure\n  -struct-text   : print logical structure and text\n  -isodates      : print the dates in ISO-8601 format\n  -rawdates      : print the undecoded date strings\n  -dests         : print all named destinations in the PDF\n  -url           : print all URLs in the PDF\n  -upw <string>  : user password\n  -opw <string>  : owner password\n",
      stderr: ""
    };
  }

  if (bytes.byteLength === 0) {
    return { exitCode: 1, stdout: "", stderr: "Syntax Error: Document stream is empty\n" };
  }

  const password = args.opw ?? args.upw;
  let doc: PdfDocument;
  try {
    doc = PdfDocument.load(bytes, password !== undefined ? { password } : {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lowerMsg = msg.toLowerCase();
    if (lowerMsg.includes("password") || lowerMsg.includes("encrypted")) {
      return { exitCode: 1, stdout: "", stderr: "Command Line Error: Incorrect password\n" };
    }
    return { exitCode: 1, stdout: "", stderr: `Syntax Error: ${msg}\n` };
  }

  const cos = doc.cos;
  const pageCount = doc.getPageCount();
  const multiPage = args.lastPageExplicit && args.lastPage !== 0;

  const firstPage = Math.max(1, args.firstPage);
  const lastPage = args.lastPageExplicit
    ? Math.min(pageCount, args.lastPage <= 0 ? pageCount : args.lastPage)
    : 1;

  if (firstPage > pageCount || (args.lastPageExplicit && firstPage > lastPage)) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${lastPage}).\n`
    };
  }

  const root = cos.resolveDict(cos.rootRef);

  // Mode priority: meta > js > struct > dests > url > ordinary (with optional custom)
  if (args.meta) {
    const metaObj = root ? cos.resolve(dictGet(root, "Metadata")) : undefined;
    if (metaObj?.kind === "stream") {
      const rawMeta = cos.decodeStream(metaObj);
      const nulIdx = rawMeta.indexOf(0);
      const slice = nulIdx >= 0 ? rawMeta.subarray(0, nulIdx) : rawMeta;
      const xml = new TextDecoder().decode(slice);
      return { exitCode: 0, stdout: sanitizeControls(xml, true) + "\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  if (args.js) {
    const actions = collectJavaScriptActions(cos);
    let out = "";
    for (const act of actions) {
      out += `Name: ${act.name}\nJS:\n${act.js}\n`;
    }
    return { exitCode: 0, stdout: out, stderr: "" };
  }

  if (args.struct) {
    const structRoot = root ? dictGet(root, "StructTreeRoot") : undefined;
    const out = dumpStructTree(cos, structRoot, args.structText);
    return { exitCode: 0, stdout: out, stderr: "" };
  }

  if (args.dests) {
    const filterRange = args.firstPage > 1 || args.lastPageExplicit;
    const effectiveLast = args.lastPageExplicit ? lastPage : pageCount;
    return {
      exitCode: 0,
      stdout: dumpDests(doc, cos, filterRange ? firstPage : 1, filterRange ? effectiveLast : pageCount),
      stderr: ""
    };
  }

  if (args.url) {
    const effectiveLast = args.lastPageExplicit ? lastPage : pageCount;
    return { exitCode: 0, stdout: dumpUrls(doc, cos, firstPage, effectiveLast), stderr: "" };
  }

  // Ordinary inspection output
  const dateMode = args.isodates ? "iso" : args.rawdates ? "raw" : "normal";
  const info = cos.infoRef ? cos.resolveDict(cos.infoRef) : undefined;
  const infoMap = new Map<string, string>();
  const customKeys: string[] = [];

  if (info) {
    for (const entry of info.entries) {
      const key = entry.key.decoded;
      const resolved = cos.resolve(entry.value);
      if (resolved?.kind === "string") {
        const text = decodePdfString(resolved);
        infoMap.set(key, text);
        if (!STANDARD_INFO_KEYS.has(key)) {
          customKeys.push(key);
        }
      }
    }
  }
  customKeys.sort((a, b) => a.localeCompare(b));

  let out = "";
  for (const key of ["Title", "Subject", "Keywords", "Author", "Creator", "Producer"]) {
    const val = infoMap.get(key);
    if (val !== undefined) out += formatField(key, val);
  }
  for (const dateKey of ["CreationDate", "ModDate"]) {
    const val = infoMap.get(dateKey);
    if (val !== undefined) out += formatField(dateKey, formatPdfDate(val, dateMode));
  }

  if (args.custom) {
    for (const customKey of customKeys) {
      const val = infoMap.get(customKey);
      if (val !== undefined) out += formatField(customKey, val);
    }
  }

  out += formatField("Custom Metadata", customKeys.length > 0 ? "yes" : "no");
  const hasMetadataStream = root ? cos.resolve(dictGet(root, "Metadata"))?.kind === "stream" : false;
  out += formatField("Metadata Stream", hasMetadataStream ? "yes" : "no");

  const markInfo = root ? cos.resolveDict(dictGet(root, "MarkInfo")) : undefined;
  const markedNode = markInfo ? cos.resolve(dictGet(markInfo, "Marked")) : undefined;
  const marked =
    (markedNode?.kind === "boolean" && markedNode.value) ||
    (root ? cos.resolveDict(dictGet(root, "StructTreeRoot")) !== undefined : false);
  const userPropsNode = markInfo ? cos.resolve(dictGet(markInfo, "UserProperties")) : undefined;
  const userProps = userPropsNode?.kind === "boolean" && userPropsNode.value;
  const suspectsNode = markInfo ? cos.resolve(dictGet(markInfo, "Suspects")) : undefined;
  const suspects = suspectsNode?.kind === "boolean" && suspectsNode.value;

  out += formatField("Tagged", marked ? "yes" : "no");
  out += formatField("UserProperties", userProps ? "yes" : "no");
  out += formatField("Suspects", suspects ? "yes" : "no");

  const acroForm = root ? cos.resolveDict(dictGet(root, "AcroForm")) : undefined;
  let formType = "none";
  if (acroForm) {
    formType = dictGet(acroForm, "XFA") !== undefined ? "XFA" : "AcroForm";
  }
  out += formatField("Form", formType);

  const hasJs = collectJavaScriptActions(cos).length > 0;
  out += formatField("JavaScript", hasJs ? "yes" : "no");
  out += formatField("Pages", String(pageCount));

  if (cos.encryption) {
    const perms = cos.encryption.permissions;
    const printFlag = perms.print ? "yes" : "no";
    const modifyFlag = perms.modify ? "yes" : "no";
    const copyFlag = perms.copy ? "yes" : "no";
    const notesFlag = perms.addNotes ? "yes" : "no";
    const alg =
      cos.encryption.revision >= 5
        ? "AES-256"
        : cos.encryption.revision === 4
          ? "AES"
          : "RC4";
    out += formatField(
      "Encrypted",
      `yes (print:${printFlag} copy:${copyFlag} change:${modifyFlag} addNotes:${notesFlag} algorithm:${alg})`
    );
  } else {
    out += formatField("Encrypted", "no");
  }

  for (let p = firstPage; p <= lastPage; p++) {
    const page = doc.getPage(p - 1);
    const mediaBox = resolvePageBox(cos, page, "MediaBox", [0, 0, 612, 792]);
    const cropBox = resolvePageBox(cos, page, "CropBox", mediaBox);
    const bleedBox = resolvePageBox(cos, page, "BleedBox", cropBox);
    const trimBox = resolvePageBox(cos, page, "TrimBox", cropBox);
    const artBox = resolvePageBox(cos, page, "ArtBox", cropBox);
    const w = Math.abs(cropBox[2] - cropBox[0]);
    const h = Math.abs(cropBox[3] - cropBox[1]);
    const label = paperSizeLabel(w, h);
    const rot = page.getRotation();

    const pagePrefix = multiPage ? `Page ${String(p).padStart(4, " ")} ` : "Page ";
    out += formatField(
      `${pagePrefix}size`,
      `${formatNumTrimmed(w)} x ${formatNumTrimmed(h)} pts${label}`
    );
    out += formatField(`${pagePrefix}rot`, String(rot));

    if (args.box) {
      out += formatField(`${pagePrefix}MediaBox`, formatBox8(mediaBox));
      out += formatField(`${pagePrefix}CropBox`, formatBox8(cropBox));
      out += formatField(`${pagePrefix}BleedBox`, formatBox8(bleedBox));
      out += formatField(`${pagePrefix}TrimBox`, formatBox8(trimBox));
      out += formatField(`${pagePrefix}ArtBox`, formatBox8(artBox));
    }
  }

  const fileSize = options.isStdin ? 0 : (options.fileSize ?? bytes.byteLength);
  out += formatField("File size", `${fileSize} bytes`);
  out += formatField("Optimized", checkLinearized(cos) ? "yes" : "no");
  out += formatField("PDF version", cos.version);

  return { exitCode: 0, stdout: applyPopplerOutputEncoding(out, args.encoding), stderr: "" };
}

export async function runPdfinfoCli(
  argv: readonly string[],
  files: ReadonlyMap<string, Uint8Array>,
  stdinBytes: Uint8Array = new Uint8Array(0)
): Promise<PdfinfoCliResult> {
  const args = parseArgs(argv);
  if (args.error) {
    return { exitCode: args.errorExitCode ?? 99, stdout: "", stderr: args.error };
  }
  if (args.listenc || args.version || args.help) {
    return inspectPdfBytes(new Uint8Array(0), argv);
  }
  const target = args.inputFile ?? "-";
  if (target === "-") {
    return inspectPdfBytes(stdinBytes, argv, { isStdin: true, fileSize: 0 });
  }
  const fileBytes = files.get(target);
  if (!fileBytes) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `I/O Error: Couldn't open file '${target}': No such file or directory.\n`
    };
  }
  return inspectPdfBytes(fileBytes, argv, { fileSize: fileBytes.byteLength });
}

export async function pdfinfo(context: CommandContext): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const parsed = parseArgs(argv);
    if (parsed.error) {
      await writeBytes(
        context.stderr,
        new TextEncoder().encode(parsed.error),
        invocation.signal
      );
      return { exitCode: parsed.errorExitCode ?? 99 };
    }
    if (parsed.listenc || parsed.version || parsed.help) {
      const res = inspectPdfBytes(new Uint8Array(0), argv);
      if (res.stdout) {
        const stdout = invocation.child(context.stdout);
        await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
      }
      return { exitCode: res.exitCode };
    }

    const inputTarget = parsed.inputFile ?? "-";
    let pdfBytes: Uint8Array;
    let isStdin = false;
    let accountedBytes = 0;
    const chargeBytes = (delta: number) => {
      if (delta > 0) {
        accountedBytes += delta;
        context.inputBudget?.check(accountedBytes);
      }
    };
    if (inputTarget === "-") {
      isStdin = true;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
        chargeBytes(chunk.byteLength);
      }
      pdfBytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        pdfBytes.set(c, offset);
        offset += c.byteLength;
      }
    } else {
      const resolvedPath = inputTarget.startsWith("/")
        ? inputTarget
        : `${context.cwd === "/" ? "" : context.cwd}/${inputTarget}`;
      try {
        pdfBytes = await context.fs.readFile(resolvedPath, { signal: invocation.signal });
        chargeBytes(pdfBytes.byteLength);
      } catch {
        const msg = `I/O Error: Couldn't open file '${inputTarget}': No such file or directory.\n`;
        await writeBytes(context.stderr, new TextEncoder().encode(msg), invocation.signal);
        return { exitCode: 1 };
      }
    }

    const res = inspectPdfBytes(pdfBytes, argv, {
      fileSize: isStdin ? 0 : pdfBytes.byteLength,
      isStdin
    });
    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdout) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }
    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createPdfinfoCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdfinfo",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Extract PDF metadata, page boxes, encryption, and structure via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return pdfinfo(context);
    }
  });
}

export const pdfinfoCommand: CommandDefinition = createPdfinfoCommand();

export async function runPdftoppmCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes?: Uint8Array }> {
  let format: "png" | "ppm" | "pgm" | "pbm" | "jpeg" | "svg" | "tif" = "ppm";
  let colorMode: "color" | "gray" | "mono" = "color";
  let dpi = 150;
  let dpiX: number | undefined;
  let dpiY: number | undefined;
  let scaleTo = 0;
  let scaleToX = 0;
  let scaleToY = 0;
  let cropX = 0;
  let cropY = 0;
  let cropW = 0;
  let cropH = 0;
  let hasCrop = false;
  let useCropBox = false;
  let hideAnnotations = false;
  let transparent = false;
  let progress = false;
  let quiet = false;
  let jpegQuality = 90;
  let firstPage = 1;
  let lastPage = 0;
  let oddOnly = false;
  let evenOnly = false;
  let singleFile = false;
  let forceNum = false;
  let sep = "-";
  let setPageNo: number | undefined;
  let password = "";
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdftoppm version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout:
          "Usage: pdftoppm [options] [PDF-file [PPM-file-prefix]]\n  -png / -ppm / -gray / -mono / -jpeg / -svg\n  -r <dpi> / -rx <dpi> / -ry <dpi> / -scale-to <px> / -f <int> / -l <int> / -singlefile / -cropbox\n",
        stderr: ""
      };
    }
    if (arg === "-png") format = "png";
    else if (arg === "-tiff") format = "tif";
    else if (arg === "-ppm") format = "ppm";
    else if (arg === "-gray" || arg === "-pgm") {
      colorMode = "gray";
      if (format === "ppm") format = "pgm";
    } else if (arg === "-mono" || arg === "-pbm") {
      colorMode = "mono";
      if (format === "ppm") format = "pbm";
    }
    else if (arg === "-jpeg" || arg === "-jpg") format = "jpeg";
    else if (arg === "-svg") format = "svg";
    else if (arg === "-singlefile") singleFile = true;
    else if (arg === "-forcenum") forceNum = true;
    else if (arg === "-o") oddOnly = true;
    else if (arg === "-e") evenOnly = true;
    else if (arg === "-cropbox") useCropBox = true;
    else if (arg === "-hide-annotations") hideAnnotations = true;
    else if (arg === "-transp") transparent = true;
    else if (arg === "-overprint") {
      // Accepted for Poppler CLI compatibility
    }
    else if (arg === "-progress") progress = true;
    else if (arg === "-q") quiet = true;
    else if (arg === "-setpageno") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(n)) setPageNo = n;
    }
    else if (arg === "-jpegopt") {
      const optStr = argv[++i] ?? "";
      for (const part of optStr.split(",")) {
        const eqIdx = part.indexOf("=");
        if (eqIdx > 0 && part.slice(0, eqIdx).trim().toLowerCase() === "quality") {
          const qVal = Number(part.slice(eqIdx + 1).trim());
          if (Number.isFinite(qVal) && qVal >= 1 && qVal <= 100) {
            jpegQuality = Math.round(qVal);
          }
        }
      }
    }
    else if (arg === "-sep") sep = argv[++i] ?? "-";
    else if (arg === "-r") dpi = Number(argv[++i] ?? "150") || 150;
    else if (arg === "-rx") dpiX = Number(argv[++i] ?? "150") || 150;
    else if (arg === "-ry") dpiY = Number(argv[++i] ?? "150") || 150;
    else if (arg === "-scale-to") scaleTo = Number(argv[++i] ?? "0") || 0;
    else if (arg === "-scale-to-x") scaleToX = Number(argv[++i] ?? "0") || 0;
    else if (arg === "-scale-to-y") scaleToY = Number(argv[++i] ?? "0") || 0;
    else if (arg === "-x") {
      cropX = Number(argv[++i] ?? "0") || 0;
      hasCrop = true;
    } else if (arg === "-y") {
      cropY = Number(argv[++i] ?? "0") || 0;
      hasCrop = true;
    } else if (arg === "-W") {
      cropW = Number(argv[++i] ?? "0") || 0;
      hasCrop = true;
    } else if (arg === "-H") {
      cropH = Number(argv[++i] ?? "0") || 0;
      hasCrop = true;
    }
    else if (arg === "-sz") {
      const sz = Number(argv[++i] ?? "0") || 0;
      cropW = sz;
      cropH = sz;
      hasCrop = true;
    }
    else if (arg === "-f") firstPage = Math.max(1, Number(argv[++i] ?? "1") || 1);
    else if (arg === "-l") lastPage = Math.max(0, Number(argv[++i] ?? "0") || 0);
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (
      arg === "-tiffcompression" ||
      arg === "-aa" ||
      arg === "-aaVector" ||
      arg === "-thinlinemode" ||
      arg === "-freetype"
    ) i++;
    else if (!arg.startsWith("-") || arg === "-") positionals.push(arg);
  }

  const inputPath = positionals[0] ?? (files.has("-") ? "-" : undefined);
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: "Usage: pdftoppm [options] [PDF-file [PPM-root]]\n" };
  }
  const pdfBytes = files.get(inputPath);
  if (!pdfBytes) {
    return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${inputPath}'\n` };
  }

  let doc: PdfDocument;
  try {
    doc = PdfDocument.load(pdfBytes, password ? { password } : undefined);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: `PDF Error: ${(err as Error).message}\n` };
  }

  const totalPages = Math.max(1, doc.pageCount);
  const endPage = lastPage > 0 ? Math.min(totalPages, lastPage) : totalPages;
  const prefix = positionals[1];
  const ext = format === "jpeg" ? "jpg" : format;
  const padWidth = Math.max(1, String(totalPages).length);
  const outChunks: Uint8Array[] = [];
  const progressLines: string[] = [];

  for (let p = firstPage; p <= endPage; p++) {
    if (oddOnly && p % 2 === 0) continue;
    if (evenOnly && p % 2 === 1) continue;
    const page = doc.getPage(p - 1);
    let rawSize = page.getSize();
    let resolvedCropBox: [number, number, number, number] | undefined;
    if (useCropBox) {
      let cur: PdfCosDict | undefined = page.pageDict;
      const visited = new Set<PdfCosDict>();
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        const cb = doc.cos.resolveArray(dictGet(cur, "CropBox"));
        if (cb && cb.items.length >= 4) {
          const nums = cb.items.slice(0, 4).map(it => {
            const r = doc.cos.resolve(it);
            return r?.kind === "number" ? r.value : 0;
          });
          resolvedCropBox = [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
          rawSize = {
            width: Math.max(1, Math.abs(nums[2]! - nums[0]!)),
            height: Math.max(1, Math.abs(nums[3]! - nums[1]!)),
          };
          break;
        }
        cur = doc.cos.resolveDict(dictGet(cur, "Parent"));
      }
    }
    const rot = page.getRotation();
    const ptW = Math.max(1, rot === 90 || rot === 270 ? rawSize.height : rawSize.width);
    const ptH = Math.max(1, rot === 90 || rot === 270 ? rawSize.width : rawSize.height);
    let effDpiX = dpiX ?? dpi;
    let effDpiY = dpiY ?? dpi;
    if (scaleTo > 0) {
      const s = (scaleTo * 72) / Math.max(ptW, ptH);
      effDpiX = s;
      effDpiY = s;
    } else {
      if (scaleToX > 0) {
        effDpiX = (scaleToX * 72) / ptW;
        if (scaleToY <= 0) effDpiY = effDpiX;
      }
      if (scaleToY > 0) {
        effDpiY = (scaleToY * 72) / ptH;
        if (scaleToX <= 0) effDpiX = effDpiY;
      }
    }

    let renderedBytes: Uint8Array;
    if (format === "svg") {
      const fullSz = page.getSize();
      let svgCropRect: PdfCropRect | undefined = hasCrop
        ? { x: cropX, y: cropY, width: cropW, height: cropH }
        : undefined;
      if (useCropBox && resolvedCropBox) {
        const sx = effDpiX / 72;
        const sy = effDpiY / 72;
        const cbScreenX = Math.min(resolvedCropBox[0], resolvedCropBox[2]) * sx;
        const cbScreenY = (fullSz.height - Math.max(resolvedCropBox[1], resolvedCropBox[3])) * sy;
        const cbScreenW = Math.abs(resolvedCropBox[2] - resolvedCropBox[0]) * sx;
        const cbScreenH = Math.abs(resolvedCropBox[3] - resolvedCropBox[1]) * sy;
        svgCropRect = svgCropRect
          ? {
              x: cbScreenX + svgCropRect.x,
              y: cbScreenY + svgCropRect.y,
              width: svgCropRect.width || cbScreenW,
              height: svgCropRect.height || cbScreenH,
            }
          : { x: cbScreenX, y: cbScreenY, width: cbScreenW, height: cbScreenH };
      }
      const svgText = renderDisplayListToSvg(page.evaluateDisplayList({ hideAnnotations }), {
        dpi: effDpiX,
        dpiX: effDpiX,
        dpiY: effDpiY,
        useCropBox,
        cropRect: svgCropRect,
        hideAnnotations,
        transparent,
      });
      renderedBytes = new TextEncoder().encode(svgText);
    } else {
      const bitmap = renderPdfPageToBitmap(doc.cos, p - 1, {
        dpi: effDpiX,
        dpiX: effDpiX,
        dpiY: effDpiY,
        useCropBox,
        hideAnnotations,
        transparent,
        ...(hasCrop ? { cropRect: { x: cropX, y: cropY, width: cropW, height: cropH } } : {}),
      });
      if (colorMode !== "color" && (format === "png" || format === "tif" || format === "jpeg")) {
        for (let px = 0; px < bitmap.data.length; px += 4) {
          const r = bitmap.data[px]!;
          const g = bitmap.data[px + 1]!;
          const b = bitmap.data[px + 2]!;
          const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          const v = colorMode === "mono" ? (lum < 128 ? 0 : 255) : lum;
          bitmap.data[px] = v;
          bitmap.data[px + 1] = v;
          bitmap.data[px + 2] = v;
        }
      }
      if (format === "png") renderedBytes = encodePng(bitmap);
      else if (format === "tif") renderedBytes = encodeTiff(bitmap, effDpiX);
      else if (format === "ppm") renderedBytes = encodePpm(bitmap);
      else if (format === "pgm") renderedBytes = encodePgm(bitmap);
      else if (format === "pbm") renderedBytes = encodePbm(bitmap);
      else renderedBytes = encodeJpeg(bitmap, jpegQuality);
    }

    if (!prefix || prefix === "-") {
      outChunks.push(renderedBytes);
      if (progress && !quiet) progressLines.push(`${p} ${endPage} -`);
    } else {
      const effectivePageNo = setPageNo !== undefined ? setPageNo + (p - firstPage) : p;
      const pageNumStr = String(effectivePageNo).padStart(
        Math.max(padWidth, String(effectivePageNo).length),
        "0"
      );
      const fileName = singleFile && !forceNum ? `${prefix}.${ext}` : `${prefix}${sep}${pageNumStr}.${ext}`;
      files.set(fileName, renderedBytes);
      if (progress && !quiet) progressLines.push(`${p} ${endPage} ${fileName}`);
    }
    if (singleFile) break;
  }

  const stderrText = progressLines.length > 0 ? progressLines.join("\n") + "\n" : "";
  if (outChunks.length > 0) {
    const totalLen = outChunks.reduce((s, c) => s + c.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let off = 0;
    for (const c of outChunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    return { exitCode: 0, stdout: "", stderr: stderrText, stdoutBytes: merged };
  }
  return { exitCode: 0, stdout: "", stderr: stderrText };
}

function formatPopplerSize(byteLength: number): string {
  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)}M`;
  }
  if (byteLength >= 1024) {
    return `${(byteLength / 1024).toFixed(1)}K`;
  }
  return `${byteLength}B`;
}

function formatPopplerRatio(
  byteLength: number,
  width: number,
  height: number,
  components: number,
  bpc: number
): string {
  const uncompressedBits = Math.max(1, width * height * components * bpc);
  const uncompressedBytes = Math.max(1, uncompressedBits / 8);
  const pct = Math.min(999, Math.max(0.1, (byteLength / uncompressedBytes) * 100));
  return `${pct.toFixed(1)}%`;
}

export async function runPdfimagesCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let listOnly = false;
  let usePng = false;
  let useJpeg = false;
  let useTiff = false;
  let useJp2 = false;
  let useJbig2 = false;
  let useCcitt = false;
  let firstPage = 1;
  let lastPage = 0;
  let includePage = false;
  let uniqueOnly = false;
  let printFilenames = false;
  let quiet = false;
  let password = "";
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdfimages version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout:
          "Usage: pdfimages [options] <PDF-file> [<image-root>]\n  -list / -png / -j / -all / -f <int> / -l <int> / -p\n",
        stderr: "",
      };
    }
    if (arg === "-list") listOnly = true;
    else if (arg === "-png") usePng = true;
    else if (arg === "-j") useJpeg = true;
    else if (arg === "-tiff") useTiff = true;
    else if (arg === "-jp2") useJp2 = true;
    else if (arg === "-jbig2") useJbig2 = true;
    else if (arg === "-ccitt") useCcitt = true;
    else if (arg === "-all") {
      usePng = true;
      useJpeg = true;
      useJp2 = true;
      useJbig2 = true;
      useCcitt = true;
    } else if (arg === "-p") includePage = true;
    else if (arg === "-u") uniqueOnly = true;
    else if (arg === "-print-filenames") printFilenames = true;
    else if (arg === "-q") quiet = true;
    else if (arg === "-f") {
      firstPage = Math.max(1, Number.parseInt(argv[++i] ?? "1", 10) || 1);
    } else if (arg === "-l") {
      lastPage = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
    } else if (arg === "-upw" || arg === "-opw") {
      password = argv[++i] ?? "";
    } else if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
    }
  }

  const inputPath = positionals[0] ?? (files.has("-") ? "-" : undefined);
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: quiet ? "" : "Usage: pdfimages [options] <PDF-file> [<image-root>]\n" };
  }
  const pdfBytes = files.get(inputPath);
  if (!pdfBytes) {
    return { exitCode: 1, stdout: "", stderr: quiet ? "" : `I/O Error: Couldn't open file '${inputPath}'\n` };
  }

  let doc: PdfDocument;
  try {
    doc = PdfDocument.load(pdfBytes, password ? { password } : undefined);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: quiet ? "" : `PDF Error: ${(err as Error).message}\n` };
  }

  const totalPages = Math.max(1, doc.pageCount);
  const endPage = lastPage > 0 ? Math.min(totalPages, lastPage) : totalPages;
  if (firstPage > totalPages || firstPage > endPage) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: quiet
        ? ""
        : `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${endPage}).\n`,
    };
  }

  const allExtracted = extractDocumentImages(doc.cos, {
    firstPage,
    ...(lastPage > 0 ? { lastPage } : {}),
  });
  const seenObjectIds = new Set<string>();
  const extracted = uniqueOnly
    ? allExtracted.filter((img) => {
        if (img.inline || !img.objectId) return true;
        const key = `${img.objectId.objNum}:${img.objectId.genNum}`;
        if (seenObjectIds.has(key)) return false;
        seenObjectIds.add(key);
        return true;
      })
    : allExtracted;

  const listLines = [
    "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio",
    "--------------------------------------------------------------------------------------------",
  ];

  const root = positionals[1] ?? "image";
  const printedFilenames: string[] = [];
  for (let idx = 0; idx < extracted.length; idx++) {
    const img = extracted[idx]!;
    const numStr = String(idx).padStart(3, "0");
    const objField =
      img.inline || !img.objectId
        ? "  [inline]"
        : `${String(img.objectId.objNum).padStart(6)} ${String(img.objectId.genNum).padStart(2)}`;
    const sizeStr = formatPopplerSize(img.byteLength).padStart(5);
    const ratioStr = formatPopplerRatio(
      img.byteLength,
      img.width,
      img.height,
      img.components,
      img.bitsPerComponent
    ).padStart(5);
    const interpStr = (img.interpolate ? "yes" : "no").padStart(6);
    const colorCol = (img.colorSpaceLabel ?? img.colorSpace).padEnd(5);
    listLines.push(
      `${String(img.pageNumber).padStart(4)} ${String(idx).padStart(5)} ${img.type.padEnd(6)} ${String(img.width).padStart(5)} ${String(img.height).padStart(6)} ${colorCol} ${String(img.components).padStart(4)} ${String(img.bitsPerComponent).padStart(3)}  ${img.encoding.padEnd(5)} ${interpStr} ${objField} ${String(img.xPpi).padStart(5)} ${String(img.yPpi).padStart(5)} ${sizeStr} ${ratioStr}`
    );

    if (!listOnly) {
      let ext: string;
      let outBytes: Uint8Array;
      if (useJpeg && img.encoding === "jpeg" && img.rawJpegBytes) {
        ext = "jpg";
        outBytes = img.rawJpegBytes;
      } else if (useJp2 && img.encoding === "jpx" && img.rawEncodedBytes) {
        ext = "jp2";
        outBytes = img.rawEncodedBytes;
      } else if (useJbig2 && img.encoding === "jbig2" && img.rawEncodedBytes) {
        ext = "jb2e";
        outBytes = img.rawEncodedBytes;
      } else if (useCcitt && img.encoding === "ccitt" && img.rawEncodedBytes) {
        ext = "ccitt";
        outBytes = img.rawEncodedBytes;
      } else if (useTiff) {
        ext = "tif";
        outBytes = encodeTiff(img.bitmap, img.xPpi);
      } else if (usePng) {
        ext = "png";
        outBytes = encodePng(img.bitmap);
      } else if (img.colorSpace === "gray" && img.bitsPerComponent === 1) {
        ext = "pbm";
        outBytes = encodePbm(img.bitmap);
      } else {
        ext = "ppm";
        outBytes = encodePpm(img.bitmap);
      }

      const outName = includePage
        ? `${root}-${String(img.pageNumber).padStart(3, "0")}-${numStr}.${ext}`
        : `${root}-${numStr}.${ext}`;
      files.set(outName, outBytes);
      if (ext === "jb2e" && img.jbig2GlobalsBytes) {
        const jb2gName = includePage
          ? `${root}-${String(img.pageNumber).padStart(3, "0")}-${numStr}.jb2g`
          : `${root}-${numStr}.jb2g`;
        files.set(jb2gName, img.jbig2GlobalsBytes);
        if (printFilenames) printedFilenames.push(jb2gName);
      }
      if (ext === "ccitt") {
        const paramsBase = includePage
          ? `${root}-${String(img.pageNumber).padStart(3, "0")}-${numStr}.params`
          : `${root}-${numStr}.params`;
        const kVal = img.ccittParams?.k ?? 0;
        const kFlag = kVal < 0 ? "-4" : kVal > 0 ? "-2" : "-1";
        const extraFlags = [
          kFlag,
          `-x ${img.width}`,
          `-y ${img.height}`,
          ...(img.ccittParams?.blackIs1 ? ["-B"] : []),
          ...(img.ccittParams?.byteAlign ? ["-A"] : []),
        ].join(" ");
        files.set(paramsBase, new TextEncoder().encode(`${extraFlags}\n`));
        if (printFilenames) printedFilenames.push(paramsBase);
      }
      if (printFilenames) printedFilenames.push(outName);
    }
  }

  if (listOnly) {
    return { exitCode: 0, stdout: listLines.join("\n") + "\n", stderr: "" };
  }
  if (printFilenames && printedFilenames.length > 0) {
    return { exitCode: 0, stdout: printedFilenames.join("\n") + "\n", stderr: "" };
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

function copyDocumentMetadata(srcDoc: PdfDocument, dstDoc: PdfDocument): void {
  const meta = srcDoc.getMetadata();
  if (meta.title) dstDoc.setTitle(meta.title);
  if (meta.author) dstDoc.setAuthor(meta.author);
  if (meta.subject) dstDoc.setSubject(meta.subject);
  if (meta.keywords) dstDoc.setKeywords(meta.keywords);
  if (meta.creator) dstDoc.setCreator(meta.creator);
  if (meta.producer) dstDoc.setProducer(meta.producer);
}

export async function runPdfuniteCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const positionals: string[] = [];
  let password = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdfunite version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout: "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n",
        stderr: ""
      };
    }
    if (arg === "-upw" || arg === "-opw") {
      password = argv[++i] ?? "";
      continue;
    }
    if (!arg.startsWith("-")) positionals.push(arg);
  }
  if (positionals.length < 3) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: "Syntax Error: pdfunite requires at least two input files and one output file.\n"
    };
  }
  const destPath = positionals[positionals.length - 1]!;
  const sourcePaths = positionals.slice(0, -1);
  const merged = PdfDocument.create();
  let copiedMeta = false;
  const mergedOutlineItems: Array<{ title: string; targetPageIdx: number }> = [];
  const mergedAttachments: DetachedEmbeddedFile[] = [];
  const seenAttachmentNames = new Set<string>();
  const mergedPageLabelNums: PdfCosNode[] = [];
  let pageOffset = 0;

  for (const srcPath of sourcePaths) {
    const srcBytes = files.get(srcPath);
    if (!srcBytes) {
      return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${srcPath}'\n` };
    }
    let srcDoc: PdfDocument;
    try {
      srcDoc = PdfDocument.load(srcBytes, password ? { password } : undefined);
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: `PDF Error: ${(err as Error).message}\n` };
    }
    if (!copiedMeta) {
      copyDocumentMetadata(srcDoc, merged);
      copiedMeta = true;
    }
    for (const att of collectEmbeddedAttachments(srcDoc)) {
      if (!seenAttachmentNames.has(att.name)) {
        seenAttachmentNames.add(att.name);
        mergedAttachments.push(att);
      }
    }
    const srcCat = srcDoc.cos.resolveDict(srcDoc.cos.rootRef);
    const collectSrcPageLabels = (plNode: PdfCosDict | undefined, visited = new Set<number>()) => {
      if (!plNode) return;
      const numsArr = srcDoc.cos.resolveArray(dictGet(plNode, "Nums"));
      if (numsArr) {
        for (let idx = 0; idx + 1 < numsArr.items.length; idx += 2) {
          const kNode = srcDoc.cos.resolve(numsArr.items[idx]);
          const vDict = srcDoc.cos.resolveDict(numsArr.items[idx + 1]);
          if (kNode?.kind === "number" && vDict) {
            const clonedEntries: Record<string, PdfCosNode> = {};
            const sNode = srcDoc.cos.resolve(dictGet(vDict, "S"));
            const stNode = srcDoc.cos.resolve(dictGet(vDict, "St"));
            const pNode = srcDoc.cos.resolve(dictGet(vDict, "P"));
            if (sNode?.kind === "name") clonedEntries.S = cosName(sNode.decoded);
            if (stNode?.kind === "number") clonedEntries.St = cosNumber(stNode.value);
            if (pNode?.kind === "string") clonedEntries.P = { kind: "string", bytes: new Uint8Array(pNode.bytes), format: pNode.format };
            mergedPageLabelNums.push(cosNumber(pageOffset + kNode.value), cosDict(clonedEntries));
          }
        }
      }
      const kidsArr = srcDoc.cos.resolveArray(dictGet(plNode, "Kids"));
      if (kidsArr) {
        for (const kid of kidsArr.items) {
          if (kid.kind === "ref") {
            if (visited.has(kid.objectNumber)) continue;
            visited.add(kid.objectNumber);
          }
          collectSrcPageLabels(srcDoc.cos.resolveDict(kid), visited);
        }
      }
    };
    if (srcCat) {
      collectSrcPageLabels(srcDoc.cos.resolveDict(dictGet(srcCat, "PageLabels")));
    }

    const srcOutlines = srcCat ? srcDoc.cos.resolveDict(dictGet(srcCat, "Outlines")) : undefined;
    const collectOutlinesFromSrc = (nodeOrRef: PdfCosNode | undefined, visited = new Set<number>()) => {
      let cur = nodeOrRef;
      while (cur) {
        if (cur.kind === "ref") {
          if (visited.has(cur.objectNumber)) break;
          visited.add(cur.objectNumber);
        }
        const d = srcDoc.cos.resolveDict(cur);
        if (!d) break;
        const tNode = srcDoc.cos.resolve(dictGet(d, "Title"));
        const title = tNode?.kind === "string" ? decodePdfString(tNode) : "";
        const localPage =
          resolveDestinationPageIndex(srcDoc, dictGet(d, "Dest") ?? dictGet(d, "A")) ?? 0;
        if (title) {
          mergedOutlineItems.push({ title, targetPageIdx: pageOffset + localPage });
        }
        const firstChild = dictGet(d, "First");
        if (firstChild) collectOutlinesFromSrc(firstChild, visited);
        cur = dictGet(d, "Next");
      }
    };
    if (srcOutlines) collectOutlinesFromSrc(dictGet(srcOutlines, "First"));

    const indices = Array.from({ length: srcDoc.pageCount }, (_, idx) => idx);
    merged.copyPagesFrom(srcDoc, indices);
    pageOffset += srcDoc.pageCount;
  }

  if (mergedOutlineItems.length > 0 && merged.pageCount > 0) {
    const dstCat = merged.cos.resolveDict(merged.cos.rootRef);
    if (dstCat) {
      const outlinesDict = cosDict({});
      const outlinesRef = merged.cos.allocateObject(outlinesDict);
      const itemRefs: Array<{ ref: ReturnType<typeof merged.cos.allocateObject>; dict: PdfCosDict }> = [];
      for (const bm of mergedOutlineItems) {
        const pRef = merged.getPage(Math.min(merged.pageCount - 1, Math.max(0, bm.targetPageIdx))).ref;
        const iDict = cosDict({
          Title: { kind: "string", bytes: new TextEncoder().encode(bm.title), format: "literal" },
          Parent: outlinesRef,
          Dest: cosArray([pRef, cosName("Fit")]),
        });
        const iRef = merged.cos.allocateObject(iDict);
        const prev = itemRefs[itemRefs.length - 1];
        if (prev) {
          prev.dict.entries.push({ key: cosName("Next"), value: iRef });
          iDict.entries.push({ key: cosName("Prev"), value: prev.ref });
        } else {
          outlinesDict.entries.push({ key: cosName("First"), value: iRef });
        }
        itemRefs.push({ ref: iRef, dict: iDict });
      }
      const lastItem = itemRefs[itemRefs.length - 1];
      if (lastItem) {
        outlinesDict.entries.push({ key: cosName("Last"), value: lastItem.ref });
        outlinesDict.entries.push({ key: cosName("Count"), value: cosNumber(itemRefs.length) });
        dstCat.entries.push({ key: cosName("Outlines"), value: outlinesRef });
      }
    }
  }

  const finalDstCat = merged.cos.resolveDict(merged.cos.rootRef);
  if (finalDstCat) {
    if (mergedAttachments.length > 0) {
      const namesPairs: PdfCosNode[] = [];
      for (const att of mergedAttachments) {
        const efRef = merged.cos.allocateObject(
          cosStream(att.data, {
            dict: cosDict({ Type: cosName("EmbeddedFile") }),
            compress: true,
          })
        );
        const fnBytes = new TextEncoder().encode(att.name);
        const fsRef = merged.cos.allocateObject(
          cosDict({
            Type: cosName("Filespec"),
            F: { kind: "string", bytes: fnBytes, format: "literal" },
            UF: { kind: "string", bytes: fnBytes, format: "literal" },
            EF: cosDict({ F: efRef, UF: efRef }),
          })
        );
        namesPairs.push({ kind: "string", bytes: fnBytes, format: "literal" }, fsRef);
      }
      const efTreeRef = merged.cos.allocateObject(cosDict({ Names: cosArray(namesPairs) }));
      finalDstCat.entries.push({
        key: cosName("Names"),
        value: merged.cos.allocateObject(cosDict({ EmbeddedFiles: efTreeRef })),
      });
    }
    if (mergedPageLabelNums.length > 0) {
      finalDstCat.entries.push({
        key: cosName("PageLabels"),
        value: merged.cos.allocateObject(cosDict({ Nums: cosArray(mergedPageLabelNums) })),
      });
    }
  }
  files.set(destPath, merged.save());
  return { exitCode: 0, stdout: "", stderr: "" };
}

function parsePdfseparateSpec(pattern: string): {
  readonly hasPageSpec: boolean;
  format(pageNumber: number): string;
} {
  let hasPageSpec = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") continue;
    if (pattern[i + 1] === "%") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") j++;
    if (pattern[j] === "d") {
      hasPageSpec = true;
      break;
    }
  }
  return {
    hasPageSpec,
    format(pageNumber: number): string {
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
          let digits = "";
          while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") {
            digits += pattern[j]!;
            j++;
          }
          if (pattern[j] === "d") {
            const width = digits.length > 0 ? Number.parseInt(digits, 10) || 0 : 0;
            const padChar = digits.startsWith("0") ? "0" : " ";
            out += width > 0 ? String(pageNumber).padStart(width, padChar) : String(pageNumber);
            replaced = true;
            i = j;
            continue;
          }
        }
        out += "%";
      }
      return out;
    },
  };
}

export async function runPdfseparateCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let firstPage = 1;
  let lastPage = 0;
  let password = "";
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdfseparate version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout: "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n",
        stderr: ""
      };
    }
    if (arg === "-f") firstPage = Math.max(1, Number(argv[++i] ?? "1") || 1);
    else if (arg === "-l") lastPage = Math.max(0, Number(argv[++i] ?? "0") || 0);
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (!arg.startsWith("-")) positionals.push(arg);
  }
  if (positionals.length < 2) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n"
    };
  }
  const srcPath = positionals[0]!;
  const pattern = positionals[1]!;
  const srcBytes = files.get(srcPath);
  if (!srcBytes) {
    return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${srcPath}'\n` };
  }
  let srcDoc: PdfDocument;
  try {
    srcDoc = PdfDocument.load(srcBytes, password ? { password } : undefined);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: `PDF Error: ${(err as Error).message}\n` };
  }
  const endPage = lastPage > 0 ? Math.min(srcDoc.pageCount, lastPage) : srcDoc.pageCount;
  if (
    firstPage > srcDoc.pageCount ||
    (lastPage > 0 && (lastPage > srcDoc.pageCount || firstPage > lastPage))
  ) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${endPage}).\n`
    };
  }
  const spec = parsePdfseparateSpec(pattern);
  const hasPageSpec = spec.hasPageSpec;
  if (endPage > firstPage && !hasPageSpec) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: `Error: '${pattern}' must contain '%d' if more than one page should be extracted\n`
    };
  }

  for (let p = firstPage; p <= endPage; p++) {
    const singleDoc = PdfDocument.create();
    copyDocumentMetadata(srcDoc, singleDoc);
    singleDoc.copyPagesFrom(srcDoc, [p - 1]);
    const outPath = spec.format(p);
    files.set(outPath, singleDoc.save());
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

function isSubsetFontTag(fontName: string): boolean {
  if (fontName.length < 8 || fontName[6] !== "+") return false;
  for (let i = 0; i < 6; i++) {
    const code = fontName.charCodeAt(i);
    if (code < 65 || code > 90) return false;
  }
  return true;
}

export async function runPdffontsCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let firstPage = 1;
  let lastPage = 0;
  let password = "";
  let showLoc = false;
  let showLocPs = false;
  let showSubst = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdffonts version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout: "Usage: pdffonts [options] [PDF-file]\n  -f <int> / -l <int> / -upw <string> / -opw <string>\n",
        stderr: ""
      };
    }
    if (arg === "-f") firstPage = Math.max(1, Number.parseInt(argv[++i] ?? "1", 10) || 1);
    else if (arg === "-l") lastPage = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (arg === "-loc") showLoc = true;
    else if (arg === "-locPS") {
      showLoc = true;
      showLocPs = true;
    } else if (arg === "-subst") showSubst = true;
    else if (!arg.startsWith("-") || arg === "-") positionals.push(arg);
  }

  const inputPath = positionals[0] ?? (files.has("-") ? "-" : undefined);
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: "Usage: pdffonts [options] [PDF-file]\n" };
  }
  const pdfBytes = files.get(inputPath);
  if (!pdfBytes) {
    return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${inputPath}'\n` };
  }

  let doc: PdfDocument;
  try {
    doc = PdfDocument.load(pdfBytes, password ? { password } : undefined);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: `PDF Error: ${(err as Error).message}\n` };
  }

  const cos = doc.cos;
  const endPage = lastPage > 0 ? Math.min(doc.pageCount, lastPage) : doc.pageCount;
  if (firstPage > doc.pageCount || (lastPage > 0 && firstPage > endPage)) {
    return {
      exitCode: 99,
      stdout: "",
      stderr: `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${endPage}).\n`
    };
  }
  const seenFontKeys = new Set<string>();
  const rows: string[] = showSubst
    ? [
        "name                                 object ID substitute font                      substitute font file",
        "------------------------------------ --------- ------------------------------------ ------------------------------------"
      ]
    : showLoc
      ? [
        "name                                 type              encoding         emb sub uni object ID location",
        "------------------------------------ ----------------- ---------------- --- --- --- --------- --------"
      ]
      : [
        "name                                 type              encoding         emb sub uni object ID",
        "------------------------------------ ----------------- ---------------- --- --- --- ---------"
      ];

  const collectFontsFromResources = (resDict: PdfCosDict | undefined, visitedForms = new Set<number>()) => {
    if (!resDict) return;
    const fontMap = cos.resolveDict(dictGet(resDict, "Font"));
    if (fontMap) {
      for (const entry of fontMap.entries) {
        const rawVal = entry.value;
        const objKey =
          rawVal.kind === "ref"
            ? `${rawVal.objectNumber}:${rawVal.generationNumber}`
            : `inline:${entry.key.decoded}`;
        if (seenFontKeys.has(objKey)) continue;
        seenFontKeys.add(objKey);

        const fontDict = cos.resolveDict(rawVal);
        if (!fontDict) continue;

        const baseFontNode = cos.resolve(dictGet(fontDict, "BaseFont") ?? dictGet(fontDict, "Name"));
        const fontName =
          baseFontNode?.kind === "name"
            ? baseFontNode.decoded
            : baseFontNode?.kind === "string"
              ? decodePdfString(baseFontNode)
              : "[none]";

        const subtypeNode = cos.resolve(dictGet(fontDict, "Subtype"));
        const rawSubtype = subtypeNode?.kind === "name" ? subtypeNode.decoded : "Type1";

        let descFontDict: PdfCosDict | undefined;
        if (rawSubtype === "Type0") {
          const descArr = cos.resolveArray(dictGet(fontDict, "DescendantFonts"));
          if (descArr && descArr.items.length > 0) {
            descFontDict = cos.resolveDict(descArr.items[0]);
          }
        }

        const descriptorDict =
          cos.resolveDict(dictGet(fontDict, "FontDescriptor")) ??
          (descFontDict ? cos.resolveDict(dictGet(descFontDict, "FontDescriptor")) : undefined);
        const hasEmbeddedFile = Boolean(
          rawSubtype === "Type3" ||
            (descriptorDict &&
              (dictGet(descriptorDict, "FontFile") ||
                dictGet(descriptorDict, "FontFile2") ||
                dictGet(descriptorDict, "FontFile3")))
        );

        let fontTypeLabel = "Type 1";
        if (rawSubtype === "TrueType") fontTypeLabel = "TrueType";
        else if (rawSubtype === "MMType1") fontTypeLabel = "MM Type 1";
        else if (rawSubtype === "Type3") fontTypeLabel = "Type 3";
        else if (rawSubtype === "Type0") {
          const descSubtype = descFontDict ? cos.resolve(dictGet(descFontDict, "Subtype")) : undefined;
          fontTypeLabel =
            descSubtype?.kind === "name" && descSubtype.decoded === "CIDFontType2"
              ? "CID TrueType"
              : "CID Type 0";
        } else if (descriptorDict && dictGet(descriptorDict, "FontFile3")) {
          fontTypeLabel = "Type 1C";
        }

        const encNode = cos.resolve(dictGet(fontDict, "Encoding"));
        let encodingLabel = "Builtin";
        if (encNode?.kind === "name") {
          const eName = encNode.decoded;
          if (eName === "WinAnsiEncoding") encodingLabel = "WinAnsi";
          else if (eName === "MacRomanEncoding") encodingLabel = "MacRoman";
          else if (eName === "StandardEncoding") encodingLabel = "Standard";
          else encodingLabel = eName;
        } else if (encNode?.kind === "dict") {
          encodingLabel = "Custom";
        }

        const embStr = hasEmbeddedFile ? "yes" : "no ";
        const subStr = isSubsetFontTag(fontName) ? "yes" : "no ";
        const uniStr = dictGet(fontDict, "ToUnicode") ? "yes" : "no ";
        const objIdStr =
          rawVal.kind === "ref"
            ? `${String(rawVal.objectNumber).padStart(6)} ${String(rawVal.generationNumber).padStart(2)}`
            : "   [none]";

        const locSuffix = showLoc
          ? ` ${hasEmbeddedFile ? "Embedded" : showLocPs ? `Substitute (${fontName})` : "Substitute"}`
          : "";
        if (showSubst) {
          if (!hasEmbeddedFile) {
            let subFontName = fontName;
            if (fontName.startsWith("Helvetica") || fontName.startsWith("Arial")) subFontName = "Nimbus Sans";
            else if (fontName.startsWith("Times")) subFontName = "Nimbus Roman";
            else if (fontName.startsWith("Courier")) subFontName = "Nimbus Mono PS";
            else if (fontName === "Symbol") subFontName = "Standard Symbols PS";
            else if (fontName === "ZapfDingbats") subFontName = "D050000L";
            const subFontFile = `/usr/share/fonts/type1/urw-base35/${subFontName.replaceAll(" ", "")}.t1`;
            rows.push(
              `${fontName.slice(0, 36).padEnd(36)} ${objIdStr} ${subFontName.slice(0, 36).padEnd(36)} ${subFontFile}`
            );
          }
        } else {
          rows.push(
            `${fontName.slice(0, 36).padEnd(36)} ${fontTypeLabel.padEnd(17)} ${encodingLabel.slice(0, 16).padEnd(16)} ${embStr} ${subStr} ${uniStr} ${objIdStr}${locSuffix}`
          );
        }

        if (rawSubtype === "Type3") {
          collectFontsFromResources(cos.resolveDict(dictGet(fontDict, "Resources")), visitedForms);
        }
      }
    }

    const extGsMap = cos.resolveDict(dictGet(resDict, "ExtGState"));
    if (extGsMap) {
      for (const gsEntry of extGsMap.entries) {
        const gsDict = cos.resolveDict(gsEntry.value);
        const gsFontArr = gsDict ? cos.resolveArray(dictGet(gsDict, "Font")) : undefined;
        if (gsFontArr && gsFontArr.items.length >= 1) {
          collectFontsFromResources(
            { kind: "dict", entries: [{ key: { kind: "name", decoded: "Font", rawBytes: new Uint8Array(0) }, value: { kind: "dict", entries: [{ key: { kind: "name", decoded: `ExtGS_${gsEntry.key.decoded}`, rawBytes: new Uint8Array(0) }, value: gsFontArr.items[0]! }] } }] },
            visitedForms
          );
        }
      }
    }

    const xobjMap = cos.resolveDict(dictGet(resDict, "XObject"));
    if (xobjMap) {
      for (const entry of xobjMap.entries) {
        if (entry.value.kind === "ref") {
          if (visitedForms.has(entry.value.objectNumber)) continue;
          visitedForms.add(entry.value.objectNumber);
        }
        const xobj = cos.resolve(entry.value);
        if (xobj?.kind === "stream") {
          const st = cos.resolve(dictGet(xobj.dict, "Subtype"));
          if (st?.kind === "name" && st.decoded === "Form") {
            collectFontsFromResources(cos.resolveDict(dictGet(xobj.dict, "Resources")), visitedForms);
          }
        }
      }
    }

    const patMap = cos.resolveDict(dictGet(resDict, "Pattern"));
    if (patMap) {
      for (const entry of patMap.entries) {
        if (entry.value.kind === "ref") {
          if (visitedForms.has(entry.value.objectNumber)) continue;
          visitedForms.add(entry.value.objectNumber);
        }
        const pat = cos.resolve(entry.value);
        if (pat?.kind === "stream") {
          collectFontsFromResources(cos.resolveDict(dictGet(pat.dict, "Resources")), visitedForms);
        }
      }
    }
  };

  const rootDict = cos.resolveDict(cos.rootRef);
  const acroFormDict = rootDict ? cos.resolveDict(dictGet(rootDict, "AcroForm")) : undefined;
  const acroDrDict = acroFormDict ? cos.resolveDict(dictGet(acroFormDict, "DR")) : undefined;

  for (let p = firstPage; p <= endPage; p++) {
    const page = doc.getPage(p - 1);
    collectFontsFromResources(page.getResourcesDict());
    const annots = cos.resolveArray(dictGet(page.pageDict, "Annots"));
    if (annots) {
      for (const item of annots.items) {
        const annotDict = cos.resolveDict(item);
        const apDict = annotDict ? cos.resolveDict(dictGet(annotDict, "AP")) : undefined;
        if (!apDict) continue;
        for (const apKey of ["N", "R", "D"]) {
          const apVal = cos.resolve(dictGet(apDict, apKey));
          if (apVal?.kind === "stream") {
            collectFontsFromResources(cos.resolveDict(dictGet(apVal.dict, "Resources")));
          } else if (apVal?.kind === "dict") {
            for (const sub of apVal.entries) {
              const subStream = cos.resolve(sub.value);
              if (subStream?.kind === "stream") {
                collectFontsFromResources(cos.resolveDict(dictGet(subStream.dict, "Resources")));
              }
            }
          }
        }
      }
    }
  }
  if (acroDrDict) {
    collectFontsFromResources(acroDrDict);
  }

  return { exitCode: 0, stdout: rows.join("\n") + "\n", stderr: "" };
}

interface DetachedEmbeddedFile {
  readonly name: string;
  readonly data: Uint8Array;
}

function collectEmbeddedAttachments(doc: PdfDocument): DetachedEmbeddedFile[] {
  const cos = doc.cos;
  const results: DetachedEmbeddedFile[] = [];
  const seenNames = new Set<string>();

  const extractFromFilespec = (fsDict: PdfCosDict | undefined, fallbackName: string) => {
    if (!fsDict) return;
    const ufNode = cos.resolve(dictGet(fsDict, "UF") ?? dictGet(fsDict, "F"));
    const name = ufNode?.kind === "string" ? decodePdfString(ufNode) : fallbackName;
    const efDict = cos.resolveDict(dictGet(fsDict, "EF"));
    const streamNode = efDict
      ? cos.resolve(
          dictGet(efDict, "UF") ??
            dictGet(efDict, "F") ??
            dictGet(efDict, "DOS") ??
            dictGet(efDict, "Mac") ??
            dictGet(efDict, "Unix")
        )
      : undefined;
    if (streamNode?.kind === "stream" && !seenNames.has(name)) {
      seenNames.add(name);
      results.push({ name, data: cos.decodeStream(streamNode) });
    }
  };

  const extractFromAfNode = (afNode: PdfCosNode | undefined, prefix: string) => {
    if (!afNode) return;
    const afArr = cos.resolveArray(afNode);
    if (afArr) {
      for (let idx = 0; idx < afArr.items.length; idx++) {
        extractFromFilespec(cos.resolveDict(afArr.items[idx]), `${prefix}_af_${idx + 1}`);
      }
    } else {
      extractFromFilespec(cos.resolveDict(afNode), `${prefix}_af`);
    }
  };

  const walkNameTree = (node: PdfCosDict | undefined, visited = new Set<number>()) => {
    if (!node) return;
    const namesArr = cos.resolveArray(dictGet(node, "Names"));
    if (namesArr) {
      for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
        const keyNode = cos.resolve(namesArr.items[i]);
        const fallback = keyNode?.kind === "string" ? decodePdfString(keyNode) : `attachment_${results.length + 1}`;
        extractFromFilespec(cos.resolveDict(namesArr.items[i + 1]), fallback);
      }
    }
    const kidsArr = cos.resolveArray(dictGet(node, "Kids"));
    if (kidsArr) {
      for (const kid of kidsArr.items) {
        if (kid.kind === "ref") {
          if (visited.has(kid.objectNumber)) continue;
          visited.add(kid.objectNumber);
        }
        walkNameTree(cos.resolveDict(kid), visited);
      }
    }
  };

  const root = cos.resolveDict(cos.rootRef);
  const namesDict = root ? cos.resolveDict(dictGet(root, "Names")) : undefined;
  walkNameTree(namesDict ? cos.resolveDict(dictGet(namesDict, "EmbeddedFiles")) : undefined);
  if (root) {
    extractFromAfNode(dictGet(root, "AF"), "catalog");
  }

  for (let p = 0; p < doc.pageCount; p++) {
    const page = doc.getPage(p);
    extractFromAfNode(dictGet(page.pageDict, "AF"), `page${p + 1}`);
    const annots = cos.resolveArray(dictGet(page.pageDict, "Annots"));
    if (!annots) continue;
    for (const item of annots.items) {
      const annot = cos.resolveDict(item);
      if (!annot) continue;
      const subtype = cos.resolve(dictGet(annot, "Subtype"));
      if (subtype?.kind === "name" && subtype.decoded === "FileAttachment") {
        extractFromFilespec(cos.resolveDict(dictGet(annot, "FS")), `page${p + 1}_attachment`);
      }
    }
  }
  return results;
}

export async function runPdfdetachCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let listOnly = false;
  let saveNumber = 0;
  let saveFileName = "";
  let saveAll = false;
  let outputPath = "";
  let password = "";
  let encoding = "UTF-8";
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdfdetach version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout:
          "Usage: pdfdetach [options] <PDF-file>\n  -list / -save <int> / -savefile <name> / -saveall / -o <path>\n",
        stderr: ""
      };
    }
    if (arg === "-list") listOnly = true;
    else if (arg === "-save") saveNumber = Number.parseInt(argv[++i] ?? "0", 10) || 0;
    else if (arg === "-savefile") saveFileName = argv[++i] ?? "";
    else if (arg === "-saveall") saveAll = true;
    else if (arg === "-o") outputPath = argv[++i] ?? "";
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (arg === "-enc") {
      const nextEnc = argv[++i] ?? "";
      if (!SUPPORTED_ENCODINGS.has(nextEnc)) {
        return {
          exitCode: 99,
          stdout: "",
          stderr: `Command Line Error: Unknown encoding '${nextEnc}'\n`
        };
      }
      encoding = nextEnc;
    }
    else if (!arg.startsWith("-") || arg === "-") positionals.push(arg);
  }

  const inputPath = positionals[0] ?? (files.has("-") ? "-" : undefined);
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: "Usage: pdfdetach [options] <PDF-file>\n" };
  }
  const pdfBytes = files.get(inputPath);
  if (!pdfBytes) {
    return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${inputPath}'\n` };
  }

  let doc: PdfDocument;
  try {
    doc = PdfDocument.load(pdfBytes, password ? { password } : undefined);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: `PDF Error: ${(err as Error).message}\n` };
  }

  const attachments = collectEmbeddedAttachments(doc);
  if (listOnly || (!saveNumber && !saveFileName && !saveAll)) {
    const lines = [`${attachments.length} embedded files`];
    for (let i = 0; i < attachments.length; i++) {
      const attName = applyPopplerOutputEncoding(attachments[i]!.name, encoding);
      lines.push(`${i + 1}: ${attName}`);
    }
    return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  if (saveNumber > 0) {
    const target = attachments[saveNumber - 1];
    if (!target) {
      return { exitCode: 1, stdout: "", stderr: `Error: Invalid file index ${saveNumber}\n` };
    }
    const dest = outputPath
      ? outputPath.endsWith("/")
        ? `${outputPath}${target.name}`
        : outputPath
      : target.name;
    files.set(dest, target.data);
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  if (saveFileName) {
    const target = attachments.find((a) => a.name === saveFileName);
    if (!target) {
      return { exitCode: 1, stdout: "", stderr: `Error: Embedded file '${saveFileName}' not found\n` };
    }
    const dest = outputPath
      ? outputPath.endsWith("/")
        ? `${outputPath}${target.name}`
        : outputPath
      : target.name;
    files.set(dest, target.data);
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  if (saveAll) {
    const prefix = outputPath ? (outputPath.endsWith("/") ? outputPath.slice(0, -1) : outputPath) : "";
    for (const att of attachments) {
      files.set(prefix ? `${prefix}/${att.name}` : att.name, att.data);
    }
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

const POPPLER_FILE_TOOL_VALUE_FLAGS = new Set([
  "-r",
  "-rx",
  "-ry",
  "-scale-to",
  "-scale-to-x",
  "-scale-to-y",
  "-f",
  "-l",
  "-x",
  "-y",
  "-W",
  "-H",
  "-sz",
  "-sep",
  "-upw",
  "-opw",
  "-aa",
  "-aaVector",
  "-thinlinemode",
  "-jpegopt",
  "-tiffcompression",
  "-freetype",
  "-save",
  "-savefile",
  "-o",
  "-enc",
  "-antialias",
  "-icc",
  "-paper",
  "-paperw",
  "-paperh",
]);

function extractPopplerFileToolPositionals(argv: readonly string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (POPPLER_FILE_TOOL_VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      pos.push(arg);
    }
  }
  return pos;
}

async function executePopplerFileTool(
  context: CommandContext,
  runner: (
    argv: readonly string[],
    files: Map<string, Uint8Array>
  ) => Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes?: Uint8Array }>
): Promise<{ exitCode: number }> {
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

    const positionals = extractPopplerFileToolPositionals(argv);
    if (positionals.length === 0 || positionals[0] === "-") {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
        chargeBytes(chunk.byteLength);
      }
      if (total > 0) {
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          buf.set(c, off);
          off += c.byteLength;
        }
        vfsFiles.set("-", buf);
      }
    }

    for (const token of positionals) {
      if (token === "-") continue;
      try {
        const bytes = await context.fs.readFile(resolveVfsPath(token), { signal: invocation.signal });
        chargeBytes(bytes.byteLength);
        vfsFiles.set(token, bytes);
      } catch {
        // Non-existing output file or prefix
      }
    }

    const existingSnap = new Map(vfsFiles);
    const res = await runner(argv, vfsFiles);
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

export function createPdftoppmCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdftoppm",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Render PDF pages to PNG, PPM, PGM, or PBM images via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePopplerFileTool(context, runPdftoppmCli);
    }
  });
}

export const pdftoppmCommand: CommandDefinition = createPdftoppmCommand();

export function createPdfimagesCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdfimages",
    runtimeIdentity: commandRuntimeIdentity,
    description: "List and extract embedded images from PDF pages via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePopplerFileTool(context, runPdfimagesCli);
    }
  });
}

export const pdfimagesCommand: CommandDefinition = createPdfimagesCommand();

export function createPdfuniteCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdfunite",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Merge multiple PDF documents into a single PDF via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePopplerFileTool(context, runPdfuniteCli);
    }
  });
}

export const pdfuniteCommand: CommandDefinition = createPdfuniteCommand();

export function createPdfseparateCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdfseparate",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Split PDF pages into individual PDF files via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePopplerFileTool(context, runPdfseparateCli);
    }
  });
}

export const pdfseparateCommand: CommandDefinition = createPdfseparateCommand();

export function createPdffontsCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdffonts",
    runtimeIdentity: commandRuntimeIdentity,
    description: "List fonts used in a PDF document via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePopplerFileTool(context, runPdffontsCli);
    }
  });
}

export const pdffontsCommand: CommandDefinition = createPdffontsCommand();

export function createPdfdetachCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdfdetach",
    runtimeIdentity: commandRuntimeIdentity,
    description: "List and extract embedded file attachments from PDF documents via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePopplerFileTool(context, runPdfdetachCli);
    }
  });
}

export const pdfdetachCommand: CommandDefinition = createPdfdetachCommand();

export async function runPdftocairoCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes?: Uint8Array }> {
  let format: "png" | "jpg" | "tif" | "svg" | "pdf" | "ps" | "eps" = "png";
  let grayMode = false;
  let monoMode = false;
  let firstPage = 1;
  let lastPage = 0;
  let cropX = 0;
  let cropY = 0;
  let cropW = 0;
  let cropH = 0;
  let hasCrop = false;
  let paperW = 0;
  let paperH = 0;
  let origPageSizes = false;
  let password = "";
  const forwardedArgs: string[] = [];
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "pdftocairo version 24.08.0\n", stderr: "" };
    }
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
      return {
        exitCode: 0,
        stdout: "Usage: pdftocairo [options] <PDF-file> [<output-file>]\n",
        stderr: ""
      };
    }
    if (arg === "-png") {
      format = "png";
      forwardedArgs.push("-png");
    } else if (arg === "-jpeg" || arg === "-jpg") {
      format = "jpg";
      forwardedArgs.push("-jpeg");
    } else if (arg === "-tiff") {
      format = "tif";
      forwardedArgs.push("-tiff");
    } else if (arg === "-svg") format = "svg";
    else if (arg === "-pdf") format = "pdf";
    else if (arg === "-ps") format = "ps";
    else if (arg === "-eps") format = "eps";
    else if (arg === "-gray") grayMode = true;
    else if (arg === "-mono") monoMode = true;
    else if (arg === "-antialias") {
      const m = (argv[++i] ?? "").toLowerCase();
      if (!["default", "none", "gray", "subpixel", "fast", "good", "best"].includes(m)) {
        return { exitCode: 99, stdout: "", stderr: "Bad '-antialias' value on command line\n" };
      }
    } else if (POPPLER_FILE_TOOL_VALUE_FLAGS.has(arg)) {
      const v = argv[++i] ?? "";
      forwardedArgs.push(arg, v);
      if (arg === "-f") firstPage = Math.max(1, Number.parseInt(v, 10) || 1);
      else if (arg === "-l") lastPage = Math.max(0, Number.parseInt(v, 10) || 0);
      else if (arg === "-x") { cropX = Math.max(0, Number.parseInt(v, 10) || 0); hasCrop = true; }
      else if (arg === "-y") { cropY = Math.max(0, Number.parseInt(v, 10) || 0); hasCrop = true; }
      else if (arg === "-W") { cropW = Math.max(0, Number.parseInt(v, 10) || 0); hasCrop = true; }
      else if (arg === "-H") { cropH = Math.max(0, Number.parseInt(v, 10) || 0); hasCrop = true; }
      else if (arg === "-upw" || arg === "-opw") password = v;
    } else if (arg.startsWith("-") && arg !== "-") {
      forwardedArgs.push(arg);
    } else {
      positionals.push(arg);
    }
  }

  const inputPath = positionals[0] ?? (files.has("-") ? "-" : undefined);
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: "Usage: pdftocairo [options] <PDF-file> [<output-file>]\n" };
  }
  const inputStem = inputPath.toLowerCase().endsWith(".pdf") ? inputPath.slice(0, -4) : inputPath;
  if (format === "svg") {
    const rawOut = positionals[1] ?? (inputPath === "-" ? "-" : `${inputStem}.svg`);
    const rootForSvg = rawOut.toLowerCase().endsWith(".svg") ? rawOut.slice(0, -4) : rawOut;
    return runPdftoppmCli(["-svg", "-singlefile", ...forwardedArgs, inputPath, rootForSvg], files);
  }
  if (format === "pdf" || format === "ps" || format === "eps") {
    const pdfBytes = files.get(inputPath);
    if (!pdfBytes) return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${inputPath}'\n` };
    const doc = PdfDocument.load(pdfBytes, password ? { password } : undefined);
    const endPage = lastPage > 0 ? Math.min(doc.pageCount, lastPage) : doc.pageCount;
    if (firstPage > doc.pageCount || firstPage > endPage) {
      return { exitCode: 99, stdout: "", stderr: "Command Line Error: Wrong page range given\n" };
    }
    const rawOut = positionals[1] ?? (inputPath === "-" ? "-" : `${inputStem}.${format}`);
    const finalOut = rawOut === "-" || rawOut.toLowerCase().endsWith(`.${format}`) ? rawOut : `${rawOut}.${format}`;
    if (format === "pdf") {
      const outDoc = PdfDocument.create();
      for (let p = firstPage; p <= endPage; p++) {
        const [copied] = outDoc.copyPagesFrom(doc, [p - 1]);
        if (copied && hasCrop) {
          const origSize = copied.getSize();
          const effW = cropW > 0 ? cropW : Math.max(1, origSize.width - cropX);
          const effH = cropH > 0 ? cropH : Math.max(1, origSize.height - cropY);
          dictSet(copied.pageDict, "MediaBox", cosArray([cosNumber(0), cosNumber(0), cosNumber(effW), cosNumber(effH)]));
          dictSet(copied.pageDict, "CropBox", cosArray([cosNumber(0), cosNumber(0), cosNumber(effW), cosNumber(effH)]));
        }
      }
      const outBytes = outDoc.save();
      if (finalOut === "-") return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: outBytes };
      files.set(finalOut, outBytes);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    const firstSize = doc.getPage(firstPage - 1).getSize();
    const psLines: string[] = [
      format === "eps" ? "%!PS-Adobe-3.0 EPSF-3.0" : "%!PS-Adobe-3.0",
      `%%BoundingBox: 0 0 ${Math.round(firstSize.width)} ${Math.round(firstSize.height)}`,
      `%%Pages: ${endPage - firstPage + 1}`,
      "%%EndComments",
    ];
    for (let p = firstPage; p <= endPage; p++) {
      const page = doc.getPage(p - 1);
      psLines.push(`%%Page: ${p - firstPage + 1} ${p - firstPage + 1}`);
      for (const b of page.extractPage().blocks) {
        for (const l of b.lines) {
          psLines.push(`${Math.round(l.bbox[0])} ${Math.round(l.bbox[1])} moveto (${l.text}) show`);
        }
      }
      psLines.push("showpage");
    }
    psLines.push("%%Trailer", "%%EOF", "");
    const psBytes = new TextEncoder().encode(psLines.join("\n"));
    if (finalOut === "-") return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: psBytes };
    files.set(finalOut, psBytes);
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  const rasterPositionals =
    positionals.length === 1 && inputPath !== "-" ? [inputPath, inputStem] : positionals;
  const snapBefore = new Map(files);
  const res = await runPdftoppmCli([...forwardedArgs, ...rasterPositionals], files);
  if (res.exitCode !== 0 || (!grayMode && !monoMode)) {
    return res;
  }
  const convertRgbaInPlace = (data: Uint8Array) => {
    for (let p = 0; p < data.length; p += 4) {
      const lum = Math.round(0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!);
      const val = monoMode ? (lum >= 128 ? 255 : 0) : lum;
      data[p] = val;
      data[p + 1] = val;
      data[p + 2] = val;
    }
  };
  if (res.stdoutBytes && format === "png") {
    const decoded = decodePng(res.stdoutBytes);
    convertRgbaInPlace(decoded.data);
    return { ...res, stdoutBytes: encodePng(decoded) };
  }
  for (const [k, v] of files.entries()) {
    if (snapBefore.get(k) !== v && k.endsWith(".png")) {
      const decoded = decodePng(v);
      convertRgbaInPlace(decoded.data);
      files.set(k, encodePng(decoded));
    }
  }
  return res;
}

export function createPdftocairoCommand(_options: PdfinfoCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "pdftocairo",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Render PDF pages to PNG, JPEG, TIFF, PDF, PS, EPS, or SVG via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePopplerFileTool(context, runPdftocairoCli);
    }
  });
}

export const pdftocairoCommand: CommandDefinition = createPdftocairoCommand();

export function pdfinfoCommands(options: PdfinfoCommandOptions = {}): VirtualShellPlugin {
  const command = createPdfinfoCommand(options);
  const ppmCmd = createPdftoppmCommand(options);
  const cairoCmd = createPdftocairoCommand(options);
  const imgCmd = createPdfimagesCommand(options);
  const uniteCmd = createPdfuniteCommand(options);
  const sepCmd = createPdfseparateCommand(options);
  const fontsCmd = createPdffontsCommand(options);
  const detachCmd = createPdfdetachCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdfinfo",
    setup(host) {
      host.commands.register(command, { replace });
      host.commands.register(ppmCmd, { replace });
      host.commands.register(cairoCmd, { replace });
      host.commands.register(imgCmd, { replace });
      host.commands.register(uniteCmd, { replace });
      host.commands.register(sepCmd, { replace });
      host.commands.register(fontsCmd, { replace });
      host.commands.register(detachCmd, { replace });
    }
  };
}
