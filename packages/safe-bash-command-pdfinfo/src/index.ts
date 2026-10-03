import { FsError } from "safe-bash-contracts/errors";
import { resolvePath } from "safe-bash-contracts/path";
import { yieldTurn, drainCooperativeSteps as drainSteps } from "safe-bash-contracts/yield";
import { InputByteBudget } from "safe-bash-contracts/io";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { PdfFileSource, PdfRetainedDocument, PdfStagedOutputs, type PdfOutputEntry, type PdfIndexStorage, type PdfRetainedFont, PdfDocument, dictGet, decodePdfString, parseContentStream, type PdfPage, type PdfCosNode, type PdfCosDict, type ParsedCosDocument } from "@poe-code/pdf-ast";

export interface PdfinfoLimits {
  readonly maxInputBytes: number;
}

export interface PdfinfoCommandOptions {
  readonly limits?: Partial<PdfinfoLimits>;
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
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
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
  const pad = Math.max(1, 17 - [...prefix].length);
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

function* inspectPdfBytesSteps(bytes: Uint8Array,
argv: readonly string[] = [],
options: PdfinfoInspectionOptions = {}): Generator<void, PdfinfoCliResult> {
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
    yield;
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
    yield;
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
    yield;
    const val = infoMap.get(key);
    if (val !== undefined) out += formatField(key, val);
  }
  for (const dateKey of ["CreationDate", "ModDate"]) {
    yield;
    const val = infoMap.get(dateKey);
    if (val !== undefined) out += formatField(dateKey, formatPdfDate(val, dateMode));
  }

  if (args.custom) {
    for (const customKey of customKeys) {
    yield;
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
    yield;
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
      const boxPrefix = multiPage ? pagePrefix : "";
      out += formatField(`${boxPrefix}MediaBox`, formatBox8(mediaBox));
      out += formatField(`${boxPrefix}CropBox`, formatBox8(cropBox));
      out += formatField(`${boxPrefix}BleedBox`, formatBox8(bleedBox));
      out += formatField(`${boxPrefix}TrimBox`, formatBox8(trimBox));
      out += formatField(`${boxPrefix}ArtBox`, formatBox8(artBox));
    }
  }

  const fileSize = options.isStdin ? 0 : (options.fileSize ?? bytes.byteLength);
  out += formatField("File size", `${fileSize} bytes`);
  out += formatField("Optimized", checkLinearized(cos) ? "yes" : "no");
  out += formatField("PDF version", cos.version);

  return { exitCode: 0, stdout: applyPopplerOutputEncoding(out, args.encoding), stderr: "" };
}

export function inspectPdfBytes(bytes: Uint8Array,
argv: readonly string[] = [],
options: PdfinfoInspectionOptions = {}): PdfinfoCliResult {
  const steps = inspectPdfBytesSteps(bytes, argv, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

function* inspectPdfBytesCooperativelySteps(bytes: Uint8Array, argv: readonly string[] = [], options: PdfinfoInspectionOptions = {}, signal?: AbortSignal): Generator<void, PdfinfoCliResult, void> {
    const steps = inspectPdfBytesSteps(bytes, argv, options);
    try {
        for (;;) {
            yield;
            const step = steps.next();
            if (step.done)
                return step.value;
        }
    }
    finally {
        steps.return({ exitCode: 1, stdout: "", stderr: "" });
    }
}

function* runPdfinfoCliSteps(argv: readonly string[], files: ReadonlyMap<string, Uint8Array>, stdinBytes: Uint8Array = new Uint8Array(0), signal?: AbortSignal): Generator<void, PdfinfoCliResult, void> {
    const args = parseArgs(argv);
    if (args.error) {
        return { exitCode: args.errorExitCode ?? 99, stdout: "", stderr: args.error };
    }
    if (args.listenc || args.version || args.help) {
        return (yield* inspectPdfBytesCooperativelySteps(new Uint8Array(0), argv, undefined, signal));
    }
    const target = args.inputFile ?? "-";
    if (target === "-") {
        return (yield* inspectPdfBytesCooperativelySteps(stdinBytes, argv, { isStdin: true, fileSize: 0 }, signal));
    }
    const fileBytes = files.get(target);
    if (!fileBytes) {
        return {
            exitCode: 1,
            stdout: "",
            stderr: `I/O Error: Couldn't open file '${target}': No such file or directory.\n`
    };
  }
  return (yield* inspectPdfBytesCooperativelySteps(fileBytes, argv, { fileSize: fileBytes.byteLength }, signal));
}
export async function runPdfinfoCli(argv: readonly string[], files: ReadonlyMap<string, Uint8Array>, stdinBytes: Uint8Array = new Uint8Array(0), signal?: AbortSignal): Promise<PdfinfoCliResult> {
    return drainSteps(runPdfinfoCliSteps(argv, files, stdinBytes, signal), signal);
}

export async function pdfinfo(context: CommandContext): Promise<{ exitCode: number }> {
  let cooperativeWork = 63;
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
      const res = await drainSteps(inspectPdfBytesCooperativelySteps(new Uint8Array(0), argv, undefined, invocation.signal), invocation.signal);
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
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
        chunks.push(chunk);
        total += chunk.byteLength;
        chargeBytes(chunk.byteLength);
      }
      pdfBytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
        pdfBytes.set(c, offset);
        offset += c.byteLength;
      }
    } else {
      const resolvedPath = resolvePath(context.cwd, inputTarget);
      try {
        pdfBytes = await context.fs.readFile(resolvedPath, { signal: invocation.signal });
        chargeBytes(pdfBytes.byteLength);
      } catch {
        const msg = `I/O Error: Couldn't open file '${inputTarget}': No such file or directory.\n`;
        await writeBytes(context.stderr, new TextEncoder().encode(msg), invocation.signal);
        return { exitCode: 1 };
      }
    }

    const res = await drainSteps(inspectPdfBytesCooperativelySteps(pdfBytes, argv, {
      fileSize: isStdin ? 0 : pdfBytes.byteLength,
      isStdin
    }, invocation.signal), invocation.signal);
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

export function createPdfinfoCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "pdfinfo",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Extract PDF metadata, page boxes, encryption, and structure via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return new InputByteBudget(maxInputBytes).run(context, pdfinfo);
    }
  });
}

export const pdfinfoCommand: CommandDefinition = createPdfinfoCommand();

import { createPdfuniteCommand } from "safe-bash-command-pdfunite";
import { createPdfseparateCommand } from "safe-bash-command-pdfseparate";
export * from "safe-bash-command-pdfunite";
export * from "safe-bash-command-pdfseparate";

function isSubsetFontTag(fontName: string): boolean {
  if (fontName.length < 8 || fontName[6] !== "+") return false;
  for (let i = 0; i < 6; i++) {
    const code = fontName.charCodeAt(i);
    if (code < 65 || code > 90) return false;
  }
  return true;
}

function formatPdfFont(font: PdfRetainedFont, options: { showLoc: boolean; showLocPs: boolean; showSubst: boolean }): string | undefined {
  const objectId = font.reference ? `${String(font.reference.objectNumber).padStart(6)} ${String(font.reference.generationNumber).padStart(2)}` : "   [none]";
  if (options.showSubst) {
    if (font.embedded) return undefined;
    let substitute = font.name;
    if (font.name.startsWith("Helvetica") || font.name.startsWith("Arial")) substitute = "Nimbus Sans";
    else if (font.name.startsWith("Times")) substitute = "Nimbus Roman";
    else if (font.name.startsWith("Courier")) substitute = "Nimbus Mono PS";
    else if (font.name === "Symbol") substitute = "Standard Symbols PS";
    else if (font.name === "ZapfDingbats") substitute = "D050000L";
    return `${font.name.slice(0, 36).padEnd(36)} ${objectId} ${substitute.slice(0, 36).padEnd(36)} /usr/share/fonts/type1/urw-base35/${substitute.replaceAll(" ", "")}.t1`;
  }
  const location = options.showLoc ? ` ${font.embedded ? "Embedded" : options.showLocPs ? `Substitute (${font.name})` : "Substitute"}` : "";
  return `${font.name.slice(0, 36).padEnd(36)} ${font.type.padEnd(17)} ${font.encoding.slice(0, 16).padEnd(16)} ${font.embedded ? "yes" : "no "} ${isSubsetFontTag(font.name) ? "yes" : "no "} ${font.unicode ? "yes" : "no "} ${objectId}${location}`;
}

function fontTableHeader(options: { showSubst: boolean; showLoc: boolean }): string[] {
    return options.showSubst
        ? [
            "name                                 object ID substitute font                      substitute font file",
            "------------------------------------ --------- ------------------------------------ ------------------------------------"
        ]
        : options.showLoc
            ? [
                "name                                 type              encoding         emb sub uni object ID location",
                "------------------------------------ ----------------- ---------------- --- --- --- --------- --------"
            ]
            : [
                "name                                 type              encoding         emb sub uni object ID",
                "------------------------------------ ----------------- ---------------- --- --- --- ---------"
            ];
}

function parsePdffontsArgs(argv: readonly string[]): PdfinfoCliResult | {
  firstPage: number; lastPage: number; password: string; showLoc: boolean; showLocPs: boolean; showSubst: boolean; inputPath: string;
} {
    let firstPage = 1;
    let lastPage = 0;
    let password = "";
    let showLoc = false;
    let showLocPs = false;
    let showSubst = false;
    let inputPath: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "-v" || arg === "--version") {
            return { exitCode: 0, stdout: "pdffonts version 24.08.0\n", stderr: "" };
        }
        if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
            return {
                exitCode: 0,
                stdout: "Usage: pdffonts [options] <PDF-file>\n  -f <int> / -l <int> / -upw <string> / -opw <string>\n",
                stderr: ""
            };
        }
        if (arg === "-f")
            firstPage = Math.max(1, Number.parseInt(argv[++i] ?? "1", 10) || 1);
        else if (arg === "-l")
            lastPage = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
        else if (arg === "-upw" || arg === "-opw")
            password = argv[++i] ?? "";
        else if (arg === "-loc")
            showLoc = true;
        else if (arg === "-locPS") {
            showLoc = true;
            showLocPs = true;
        }
        else if (arg === "-subst")
            showSubst = true;
        else if (!arg.startsWith("-") || arg === "-")
            inputPath ??= arg;
    }
    if (!inputPath) {
        return { exitCode: 99, stdout: "", stderr: "Usage: pdffonts [options] <PDF-file>\n" };
    }
    return { firstPage, lastPage, password, showLoc, showLocPs, showSubst, inputPath };
}

function* runPdffontsCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal): Generator<void, {
    exitCode: number;
    stdout: string;
    stderr: string;
}, void> {
    let cooperativeWork = 63;
    const plan = parsePdffontsArgs(argv);
    if ("exitCode" in plan) return plan;
    const { firstPage, lastPage, password, showLoc, showLocPs, showSubst, inputPath } = plan;
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
    const rows = fontTableHeader({ showSubst, showLoc });
    const collectFontsFromResources = (resDict: PdfCosDict | undefined, visitedForms = new Set<number>()) => {
        if (!resDict)
            return;
        const fontMap = cos.resolveDict(dictGet(resDict, "Font"));
        if (fontMap) {
            for (const entry of fontMap.entries) {
                const rawVal = entry.value;
                const objKey = rawVal.kind === "ref"
                    ? `${rawVal.objectNumber}:${rawVal.generationNumber}`
                    : `inline:${entry.key.decoded}`;
                if (seenFontKeys.has(objKey))
                    continue;
                seenFontKeys.add(objKey);
                const fontDict = cos.resolveDict(rawVal);
                if (!fontDict)
                    continue;
                const baseFontNode = cos.resolve(dictGet(fontDict, "BaseFont") ?? dictGet(fontDict, "Name"));
                const fontName = baseFontNode?.kind === "name"
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
                const descriptorDict = cos.resolveDict(dictGet(fontDict, "FontDescriptor")) ??
                    (descFontDict ? cos.resolveDict(dictGet(descFontDict, "FontDescriptor")) : undefined);
                const hasEmbeddedFile = Boolean(rawSubtype === "Type3" ||
                    (descriptorDict &&
                        (dictGet(descriptorDict, "FontFile") ||
                            dictGet(descriptorDict, "FontFile2") ||
                            dictGet(descriptorDict, "FontFile3"))));
                let fontTypeLabel = "Type 1";
                if (rawSubtype === "TrueType")
                    fontTypeLabel = "TrueType";
                else if (rawSubtype === "MMType1")
                    fontTypeLabel = "MM Type 1";
                else if (rawSubtype === "Type3")
                    fontTypeLabel = "Type 3";
                else if (rawSubtype === "Type0") {
                    const descSubtype = descFontDict ? cos.resolve(dictGet(descFontDict, "Subtype")) : undefined;
                    fontTypeLabel =
                        descSubtype?.kind === "name" && descSubtype.decoded === "CIDFontType2"
                            ? "CID TrueType"
                            : "CID Type 0";
                }
                else if (descriptorDict && dictGet(descriptorDict, "FontFile3")) {
                    fontTypeLabel = "Type 1C";
                }
                const encNode = cos.resolve(dictGet(fontDict, "Encoding"));
                let encodingLabel = "Builtin";
                if (encNode?.kind === "name") {
                    const eName = encNode.decoded;
                    if (eName === "WinAnsiEncoding")
                        encodingLabel = "WinAnsi";
                    else if (eName === "MacRomanEncoding")
                        encodingLabel = "MacRoman";
                    else if (eName === "StandardEncoding")
                        encodingLabel = "Standard";
                    else
                        encodingLabel = eName;
                }
                else if (encNode?.kind === "dict") {
                    encodingLabel = "Custom";
                }
                const row = formatPdfFont({ name: fontName, type: fontTypeLabel, encoding: encodingLabel,
                  embedded: hasEmbeddedFile, unicode: Boolean(dictGet(fontDict, "ToUnicode")), ...(rawVal.kind === "ref" ? { reference: rawVal } : {}),
                }, { showLoc, showLocPs, showSubst });
                if (row !== undefined) rows.push(row);
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
                    collectFontsFromResources({ kind: "dict", entries: [{ key: { kind: "name", decoded: "Font", rawBytes: new Uint8Array(0) }, value: { kind: "dict", entries: [{ key: { kind: "name", decoded: `ExtGS_${gsEntry.key.decoded}`, rawBytes: new Uint8Array(0) }, value: gsFontArr.items[0]! }] } }] }, visitedForms);
                }
            }
        }
        const xobjMap = cos.resolveDict(dictGet(resDict, "XObject"));
        if (xobjMap) {
            for (const entry of xobjMap.entries) {
                if (entry.value.kind === "ref") {
                    if (visitedForms.has(entry.value.objectNumber))
                        continue;
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
                    if (visitedForms.has(entry.value.objectNumber))
                        continue;
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
        yield;
        const page = doc.getPage(p - 1);
        collectFontsFromResources(page.getResourcesDict());
        const annots = cos.resolveArray(dictGet(page.pageDict, "Annots"));
        if (annots) {
            for (const item of annots.items) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const annotDict = cos.resolveDict(item);
                const apDict = annotDict ? cos.resolveDict(dictGet(annotDict, "AP")) : undefined;
                if (!apDict)
                    continue;
                for (const apKey of ["N", "R", "D"]) {
                    if (++cooperativeWork % 64 === 0)
                        yield;
                    const apVal = cos.resolve(dictGet(apDict, apKey));
                    if (apVal?.kind === "stream") {
                        collectFontsFromResources(cos.resolveDict(dictGet(apVal.dict, "Resources")));
                    }
                    else if (apVal?.kind === "dict") {
                        for (const sub of apVal.entries) {
                            if (++cooperativeWork % 64 === 0)
                                yield;
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
export async function runPdffontsCli(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}> {
    return drainSteps(runPdffontsCliSteps(argv, files, signal), signal);
}
export function runPdffontsCliSync(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal): {
    exitCode: number;
    stdout: string;
    stderr: string;
} {
    const steps = runPdffontsCliSteps(argv, files, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
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

function attachmentBasename(name: string): string {
  const leaf = name.split("/").at(-1)!.split("\\").at(-1)!;
  if (!leaf || leaf === "." || leaf === ".." || leaf.includes("\0")) {
    throw new Error("Invalid embedded attachment filename");
  }
  return leaf;
}

function parsePdfdetachArgs(argv: readonly string[]): PdfinfoCliResult | {
  listOnly: boolean; saveNumber: number; saveFileName: string; saveAll: boolean;
  outputPath: string; password: string; encoding: string; inputPath: string;
} {
    let listOnly = false;
    let saveNumber = 0;
    let saveFileName = "";
    let saveAll = false;
    let outputPath = "";
    let password = "";
    let encoding = "UTF-8";
    let inputPath: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "-v" || arg === "--version") {
            return { exitCode: 0, stdout: "pdfdetach version 24.08.0\n", stderr: "" };
        }
        if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
            return {
                exitCode: 0,
                stdout: "Usage: pdfdetach [options] <PDF-file>\n  -list / -save <int> / -savefile <name> / -saveall / -o <path>\n",
                stderr: ""
            };
        }
        if (arg === "-list")
            listOnly = true;
        else if (arg === "-save")
            saveNumber = Number.parseInt(argv[++i] ?? "0", 10) || 0;
        else if (arg === "-savefile")
            saveFileName = argv[++i] ?? "";
        else if (arg === "-saveall")
            saveAll = true;
        else if (arg === "-o")
            outputPath = argv[++i] ?? "";
        else if (arg === "-upw" || arg === "-opw")
            password = argv[++i] ?? "";
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
        else if (!arg.startsWith("-") || arg === "-")
            inputPath ??= arg;
    }
    if (!inputPath) {
        return { exitCode: 99, stdout: "", stderr: "Usage: pdfdetach [options] <PDF-file>\n" };
    }
    return { listOnly, saveNumber, saveFileName, saveAll, outputPath, password, encoding, inputPath };
}

function* runPdfdetachCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal): Generator<void, {
    exitCode: number;
    stdout: string;
    stderr: string;
}, void> {
    let cooperativeWork = 63;
    const plan = parsePdfdetachArgs(argv);
    if ("exitCode" in plan) return plan;
    const { listOnly, saveNumber, saveFileName, saveAll, outputPath, password, encoding, inputPath } = plan;
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
            if (++cooperativeWork % 64 === 0)
                yield;
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
                ? `${outputPath}${attachmentBasename(target.name)}`
                : outputPath
            : attachmentBasename(target.name);
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
                ? `${outputPath}${attachmentBasename(target.name)}`
                : outputPath
            : attachmentBasename(target.name);
        files.set(dest, target.data);
        return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (saveAll) {
        const prefix = outputPath ? (outputPath.endsWith("/") ? outputPath.slice(0, -1) : outputPath) : "";
        for (const att of attachments) {
            if (++cooperativeWork % 64 === 0)
                yield;
            const name = attachmentBasename(att.name);
            files.set(prefix ? `${prefix}/${name}` : name, att.data);
        }
    }
    return { exitCode: 0, stdout: "", stderr: "" };
}
export async function runPdfdetachCli(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}> {
    return drainSteps(runPdfdetachCliSteps(argv, files, signal), signal);
}
export function runPdfdetachCliSync(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal): {
    exitCode: number;
    stdout: string;
    stderr: string;
} {
    const steps = runPdfdetachCliSteps(argv, files, signal);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}



export function createPdffontsCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "pdffonts",
    runtimeIdentity: commandRuntimeIdentity,
    description: "List fonts used in a PDF document via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePdffonts(context, { limits: { maxInputBytes } });
    }
  });
}

export const pdffontsCommand: CommandDefinition = createPdffontsCommand();

interface RetainedCommandOutput {
  storage: PdfIndexStorage;
  signal: AbortSignal;
  emit(text: string): Promise<void>;
  error(text: string, exitCode: number): Promise<{ exitCode: number }>;
}
async function executeRetainedPdf<Plan extends { inputPath: string; password: string }>(
  context: CommandContext, options: PdfinfoCommandOptions, plan: Plan | PdfinfoCliResult,
  inspect: (document: PdfRetainedDocument, plan: Plan, output: RetainedCommandOutput) => Promise<{ exitCode: number }>,
): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  const signal = invocation.signal;
  const output = invocation.child(context.stdout).output;
  const emit = (text: string) => writeBytes(output, new TextEncoder().encode(text), signal);
  const error = async (text: string, exitCode: number) => {
    await writeBytes(context.stderr, new TextEncoder().encode(text), signal); return { exitCode };
  };
  let source: PdfFileSource | undefined;
  let document: PdfRetainedDocument | undefined;
  let failed = false;
  try {
    if ("exitCode" in plan) { if (plan.stdout) await emit(plan.stdout); return await error(plan.stderr, plan.exitCode); }
    const storage = { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || "/tmp") };
    const maxInputBytes = Math.min(InputByteBudget.limit(options.limits?.maxInputBytes), context.inputBudget?.maxBytes ?? Infinity);
    try {
      if (plan.inputPath === "-") {
        async function* input() {
          let total = 0;
          for await (const bytes of readBytes(context.stdin, signal)) { total += bytes.length; context.inputBudget?.check(total); yield bytes; }
        }
        source = await PdfFileSource.fromStream(context.fs, storage.directory, input(), { maxInputBytes, signal });
      } else {
        const path = resolvePath(context.cwd, plan.inputPath);
        context.inputBudget?.check((await context.fs.stat(path, { signal })).size);
        source = await PdfFileSource.open(context.fs, path, { maxInputBytes, signal });
        context.inputBudget?.check(source.size);
      }
    } catch (failure) {
      signal.throwIfAborted();
      if (failure instanceof Error && "code" in failure && failure.code === "ENOENT") return await error(`I/O Error: Couldn't open file '${plan.inputPath}'\n`, 1);
      throw failure;
    }
    if (plan.inputPath === "-" && source.size === 0) return await error("I/O Error: Couldn't open file '-'\n", 1);
    try { document = await PdfRetainedDocument.open(source, storage, { recovery: "repair", password: plan.password, signal }); }
    catch (failure) {
      signal.throwIfAborted();
      if (failure instanceof Error && "code" in failure && (failure.code === "E_LIMIT" || failure.code === "E_CAPABILITY")) throw failure;
      return await error(`PDF Error: ${(failure as Error).message}\n`, 1);
    }
    return await inspect(document, plan, { storage, signal, emit, error });
  } catch (failure) { failed = true; throw failure; } finally {
    // Close all acquired resources even if one backend cleanup fails.
    const results = await Promise.allSettled([document?.close(), source?.close(), invocation.close()]);
    if (!failed) await Promise.all(results.map(result => result.status === "rejected" ? Promise.reject(result.reason) : undefined));
  }
}

/** Execute attachment extraction with caller-owned retained input and staging. */
export async function executePdfdetach(context: CommandContext, options: PdfinfoCommandOptions = {}): Promise<{ exitCode: number }> {
  return executeRetainedPdf(context, options, parsePdfdetachArgs(getCommandArguments(context).args), async (doc, plan, { storage, signal, emit, error }) => {
    let outputs: PdfStagedOutputs | undefined; let failed = false;
    try {
      const listing = plan.listOnly || (!plan.saveNumber && !plan.saveFileName && !plan.saveAll);
      if (listing) {
        let count = 0;
        // Validate all payloads before stdout, preserving buffered-runner errors.
        for await (const attachment of doc.attachments()) { for await (const ignored of attachment.contents()) { signal.throwIfAborted(); } count++; }
        await emit(`${count} embedded files\n`);
        for await (const attachment of doc.attachments()) await emit(`${attachment.index + 1}: ${applyPopplerOutputEncoding(attachment.name, plan.encoding)}\n`);
        return { exitCode: 0 };
      }
      let destination = plan.outputPath;
      if (destination && !destination.endsWith("/")) {
        try { if ((await context.fs.stat(resolvePath(context.cwd, destination), { signal })).type === "directory") destination += "/"; }
        catch (failure) { if (!(failure instanceof Error) || !("code" in failure) || (failure.code !== "ENOENT" && failure.code !== "ENOTDIR")) throw failure; }
      }
      let selected = false;
      const selection = plan;
      async function* entries(): AsyncGenerator<PdfOutputEntry> {
        for await (const attachment of doc.attachments()) {
          const matches = selection.saveNumber > 0 ? attachment.index === selection.saveNumber - 1 : selection.saveFileName ? attachment.name === selection.saveFileName : selection.saveAll;
          if (!matches) { for await (const ignored of attachment.contents()) { signal.throwIfAborted(); } continue; }
          selected = true;
          const explicit = (selection.saveNumber > 0 || selection.saveFileName) && destination && !destination.endsWith("/");
          const basename = explicit ? "" : attachmentBasename(attachment.name);
          const name = explicit ? destination : destination ? `${destination.endsWith("/") ? destination.slice(0, -1) : destination}/${basename}` : basename;
          yield { name, chunks: attachment.contents() };
        }
      }
      outputs = await PdfStagedOutputs.create(storage, entries(), { signal });
      if (!selected && plan.saveNumber > 0) return await error(`Error: Invalid file index ${plan.saveNumber}\n`, 1);
      if (!selected && plan.saveFileName) return await error(`Error: Embedded file '${plan.saveFileName}' not found\n`, 1);
      for await (const entry of outputs.entries()) {
        try { await publishPdfOutput(context, resolvePath(context.cwd, entry.name), entry.contents(), signal); }
        catch (failure) {
          signal.throwIfAborted();
          if (!(failure instanceof Error) || !("code" in failure)) throw failure;
          return await error(`I/O Error: Error saving embedded file as '${entry.name}'\n`, 2);
        }
      }
      return { exitCode: 0 };
    } catch (failure) { failed = true; throw failure; } finally {
      await outputs?.close().catch(failure => { if (!failed) throw failure; });
    }
  });
}

/** Stream font inspection through the same retained engine used by the command. */
export async function executePdffonts(context: CommandContext, options: PdfinfoCommandOptions = {}): Promise<{ exitCode: number }> {
  return executeRetainedPdf(context, options, parsePdffontsArgs(getCommandArguments(context).args), async (doc, plan, { emit, error, signal }) => {
    let count = 0;
    for await (const ignored of doc.pages()) count++;
    const endPage = plan.lastPage > 0 ? Math.min(count, plan.lastPage) : count;
    if (plan.firstPage > count || (plan.lastPage > 0 && plan.firstPage > endPage)) {
      return error(`Command Line Error: Wrong page range given: the first page (${plan.firstPage}) can not be after the last page (${endPage}).\n`, 99);
    }
    await emit(fontTableHeader(plan).join("\n") + "\n");
    for await (const font of doc.fonts({ firstPage: plan.firstPage, lastPage: endPage })) {
      await yieldTurn(signal);
      const row = formatPdfFont(font, plan);
      if (row !== undefined) await emit(row + "\n");
    }
    return { exitCode: 0 };
  });
}

async function publishPdfOutput(context: CommandContext, path: string, chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<void> {
  const fs = context.fs;
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: true, stagingAncestry: true }) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup || !capabilities.atomicStagingAncestry ||
      !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile) {
    throw new FsError("ENOTSUP", { path, message: "PDF output requires retained atomic staging" });
  }
  const resolution = await fs.prepareStagingResolution(path, { signal });
  const directory = resolvePath(resolution.path, "..");
  const staging = await fs.createStagedFile(`${directory}/.pdf-${crypto.randomUUID()}`, "output", { type: "file", data: new Uint8Array() },
    { parent: resolution.parent, retainCleanup: true, signal });
  let failed = false;
  try {
    if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP", { path, message: "PDF backend omitted retained staging handles" });
    for await (const bytes of chunks) await writeFileOutput({ ...context, signal }, bytes, data => staging.writer!.write(data, { signal }));
    const stat = await staging.writer.finish({ signal });
    await fs.publishStagedFile({ ...staging, file: { ...staging.file, stat } }, resolution.path,
      { parent: resolution.parent, destination: resolution.destination, ancestors: resolution.ancestors, commitGuard: resolution.validate, signal });
  } catch (failure) { failed = true; throw failure; } finally {
    const cleanup = async () => { try { await staging.cleanup?.remove(); } finally { await staging.cleanup?.close(); } };
    await cleanup().catch(failure => { if (!failed) throw failure; });
  }
}

export function createPdfdetachCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "pdfdetach",
    runtimeIdentity: commandRuntimeIdentity,
    description: "List and extract embedded file attachments from PDF documents via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePdfdetach(context, { limits: { maxInputBytes } });
    }
  });
}

export const pdfdetachCommand: CommandDefinition = createPdfdetachCommand();

export function pdfinfoCommands(options: PdfinfoCommandOptions = {}): VirtualShellPlugin {
  const command = createPdfinfoCommand(options);
  const uniteCmd = createPdfuniteCommand(options);
  const sepCmd = createPdfseparateCommand(options);
  const fontsCmd = createPdffontsCommand(options);
  const detachCmd = createPdfdetachCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdfinfo",
    setup(host) {
      host.commands.register(command, { replace });
      host.commands.register(uniteCmd, { replace });
      host.commands.register(sepCmd, { replace });
      host.commands.register(fontsCmd, { replace });
      host.commands.register(detachCmd, { replace });
    }
  };
}

export type PdfinfoCommandsOptions = PdfinfoCommandOptions;

export function createPdfinfoCommands(options: PdfinfoCommandsOptions = {}): readonly CommandDefinition[] {
    return [createPdfinfoCommand(options), createPdfuniteCommand(options), createPdfseparateCommand(options), createPdffontsCommand(options), createPdfdetachCommand(options)];
}
