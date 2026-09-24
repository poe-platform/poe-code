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
  dictGet,
  decodePdfString,
  decodePng,
  encodePng,
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

function formatPdfDate(raw: string, mode: "normal" | "iso" | "raw"): string {
  if (mode === "raw") return sanitizeControls(raw);
  const trimmed = raw.startsWith("D:") ? raw.slice(2) : raw;
  const m =
    /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz]|[+-])(\d{2})?'?(\d{2})?'?)?/.exec(
      trimmed
    );
  if (!m || !m[1]) return sanitizeControls(raw);

  const year = m[1];
  const month = m[2] ?? "01";
  const day = m[3] ?? "01";
  const hour = m[4] ?? "00";
  const minute = m[5] ?? "00";
  const second = m[6] ?? "00";
  const tzSign = m[7];
  const tzHour = m[8] ?? "00";
  const tzMin = m[9] ?? "00";

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

  const dateObj = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Number.isNaN(dateObj.getTime())) return sanitizeControls(raw);
  return dateObj.toUTCString();
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

  const extractJsFromAction = (actionNode: PdfCosNode | undefined, label: string) => {
    const d = cos.resolveDict(actionNode);
    if (!d) return;
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
  };

  extractJsFromAction(dictGet(root, "OpenAction"), "Document OpenAction");
  return actions;
}

function dumpStructTree(
  cos: ParsedCosDocument,
  node: PdfCosNode | undefined,
  includeText: boolean,
  indent = 0
): string {
  const deref = cos.resolve(node);
  if (!deref) return "";
  const pad = "  ".repeat(indent);
  let out = "";
  if (deref.kind === "array") {
    for (const item of deref.items) {
      out += dumpStructTree(cos, item, includeText, indent);
    }
    return out;
  }
  if (deref.kind === "dict") {
    const sObj = cos.resolve(dictGet(deref, "S"));
    const role = sObj?.kind === "name" ? sObj.decoded : "StructTreeRoot";
    out += `${pad}${role}\n`;
    if (includeText) {
      const actual = cos.resolve(dictGet(deref, "ActualText"));
      if (actual?.kind === "string") {
        const text = decodePdfString(actual);
        if (text) out += `${pad}  "${text}"\n`;
      }
    }
    const kids = dictGet(deref, "K");
    if (kids) {
      out += dumpStructTree(cos, kids, includeText, indent + 1);
    }
  }
  return out;
}

function dumpDests(doc: PdfDocument, cos: ParsedCosDocument): string {
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
        const action = cos.resolveDict(dictGet(annot, "A"));
        if (action) {
          const uri = cos.resolve(dictGet(action, "URI"));
          if (uri?.kind === "string") {
            out += `${String(p).padStart(4, " ")}  Annotation    ${decodePdfString(uri)}\n`;
          }
        }
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
    if (/password|encrypted/i.test(msg)) {
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
      const xml = new TextDecoder().decode(cos.decodeStream(metaObj));
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
    return { exitCode: 0, stdout: dumpDests(doc, cos), stderr: "" };
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

  return { exitCode: 0, stdout: out, stderr: "" };
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
    if (inputTarget === "-") {
      isStdin = true;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
        chunks.push(chunk);
        total += chunk.byteLength;
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

function encodeNetpbmFromRgba(
  width: number,
  height: number,
  rgba: Uint8Array,
  mode: "ppm" | "pgm" | "pbm"
): Uint8Array {
  const enc = new TextEncoder();
  if (mode === "ppm") {
    const header = enc.encode(`P6\n${width} ${height}\n255\n`);
    const out = new Uint8Array(header.length + width * height * 3);
    out.set(header, 0);
    let dst = header.length;
    for (let i = 0; i < width * height; i++) {
      out[dst++] = rgba[i * 4]!;
      out[dst++] = rgba[i * 4 + 1]!;
      out[dst++] = rgba[i * 4 + 2]!;
    }
    return out;
  }
  if (mode === "pgm") {
    const header = enc.encode(`P5\n${width} ${height}\n255\n`);
    const out = new Uint8Array(header.length + width * height);
    out.set(header, 0);
    let dst = header.length;
    for (let i = 0; i < width * height; i++) {
      const r = rgba[i * 4]!;
      const g = rgba[i * 4 + 1]!;
      const b = rgba[i * 4 + 2]!;
      out[dst++] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return out;
  }
  const header = enc.encode(`P4\n${width} ${height}\n`);
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(header.length + rowBytes * height);
  out.set(header, 0);
  let dst = header.length;
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < rowBytes; bx++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit;
        if (x < width) {
          const idx = (y * width + x) * 4;
          const lum = 0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!;
          if (lum < 128) {
            byteVal |= 1 << (7 - bit);
          }
        }
      }
      out[dst++] = byteVal;
    }
  }
  return out;
}

export async function runPdftoppmCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes?: Uint8Array }> {
  let format: "png" | "ppm" | "pgm" | "pbm" = "ppm";
  let dpi = 150;
  let scaleTo = 0;
  let firstPage = 1;
  let lastPage = 0;
  let singleFile = false;
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
        stdout: "Usage: pdftoppm [options] [PDF-file [PPM-file-prefix]]\n  -png / -ppm / -gray / -mono\n  -r <dpi> / -scale-to <px> / -f <int> / -l <int> / -singlefile\n",
        stderr: ""
      };
    }
    if (arg === "-png") format = "png";
    else if (arg === "-ppm") format = "ppm";
    else if (arg === "-gray" || arg === "-pgm") format = "pgm";
    else if (arg === "-mono" || arg === "-pbm") format = "pbm";
    else if (arg === "-singlefile") singleFile = true;
    else if (arg === "-r" || arg === "-rx" || arg === "-ry") dpi = Number(argv[++i] ?? "150") || 150;
    else if (arg === "-scale-to" || arg === "-scale-to-x" || arg === "-scale-to-y") scaleTo = Number(argv[++i] ?? "0") || 0;
    else if (arg === "-f") firstPage = Math.max(1, Number(argv[++i] ?? "1") || 1);
    else if (arg === "-l") lastPage = Math.max(0, Number(argv[++i] ?? "0") || 0);
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (arg === "-x" || arg === "-y" || arg === "-W" || arg === "-H") i++;
    else if (arg === "-cropbox" || arg === "-aa" || arg === "-aaVector") {
      if (arg === "-aa" || arg === "-aaVector") i++;
    } else if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
    }
  }

  const inputPath = positionals[0];
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: "Usage: pdftoppm [options] [PDF-file [PPM-file-prefix]]\n" };
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
  const ext = format;
  const outChunks: Uint8Array[] = [];

  for (let p = firstPage; p <= endPage; p++) {
    const page = doc.getPage(p - 1);
    const { width: ptW, height: ptH } = page.getSize();
    const scale = scaleTo > 0 ? scaleTo / Math.max(ptW, ptH, 1) : dpi / 72;
    const pngBytes = page.renderToPng({ scale });
    let renderedBytes = pngBytes;
    if (format !== "png") {
      const decoded = decodePng(pngBytes);
      renderedBytes = encodeNetpbmFromRgba(decoded.width, decoded.height, decoded.data, format);
    }
    if (!prefix || prefix === "-") {
      outChunks.push(renderedBytes);
    } else {
      const fileName = singleFile ? `${prefix}.${ext}` : `${prefix}-${p}.${ext}`;
      files.set(fileName, renderedBytes);
    }
    if (singleFile) break;
  }

  if (outChunks.length > 0) {
    const totalLen = outChunks.reduce((s, c) => s + c.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let off = 0;
    for (const c of outChunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: merged };
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

export async function runPdfimagesCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let listOnly = false;
  let usePng = false;
  let firstPage = 1;
  let lastPage = 0;
  let includePage = false;
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
        stdout: "Usage: pdfimages [options] <PDF-file> [<image-root>]\n  -list / -png / -all / -f <int> / -l <int> / -p\n",
        stderr: ""
      };
    }
    if (arg === "-list") listOnly = true;
    else if (arg === "-png" || arg === "-all") usePng = true;
    else if (arg === "-p") includePage = true;
    else if (arg === "-f") firstPage = Math.max(1, Number(argv[++i] ?? "1") || 1);
    else if (arg === "-l") lastPage = Math.max(0, Number(argv[++i] ?? "0") || 0);
    else if (arg === "-upw" || arg === "-opw") password = argv[++i] ?? "";
    else if (!arg.startsWith("-")) positionals.push(arg);
  }

  const inputPath = positionals[0];
  if (!inputPath) {
    return { exitCode: 99, stdout: "", stderr: "Usage: pdfimages [options] <PDF-file> [<image-root>]\n" };
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
  const root = positionals[1] ?? "image";

  const listLines = [
    "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio",
    "--------------------------------------------------------------------------------------------"
  ];
  let imgIndex = 0;
  for (let p = firstPage; p <= endPage; p++) {
    const dl = doc.getPage(p - 1).evaluateDisplayList();
    for (const img of dl.images) {
      const numStr = String(imgIndex).padStart(3, "0");
      const colorShort = img.colorSpace === "DeviceGray" ? "gray" : img.colorSpace === "DeviceCMYK" ? "cmyk" : "rgb";
      const comp = colorShort === "gray" ? 1 : colorShort === "cmyk" ? 4 : 3;
      const byteSize = img.width * img.height * comp;
      listLines.push(
        `${String(p).padStart(4)} ${String(imgIndex).padStart(5)}  image  ${String(img.width).padStart(5)} ${String(img.height).padStart(6)} ${colorShort.padEnd(5)} ${String(comp).padStart(4)} ${String(img.bitsPerComponent).padStart(3)}  image   no       ${String(imgIndex + 1).padStart(6)}  0    72    72 ${String(byteSize).padStart(4)}B 100%`
      );
      if (!listOnly && img.decodedRgba) {
        const ext = usePng ? "png" : "ppm";
        const outBytes = usePng
          ? encodePng({ width: img.width, height: img.height, data: img.decodedRgba })
          : encodeNetpbmFromRgba(img.width, img.height, img.decodedRgba, "ppm");
        const outName = includePage
          ? `${root}-${String(p).padStart(3, "0")}-${numStr}.${ext}`
          : `${root}-${numStr}.${ext}`;
        files.set(outName, outBytes);
      }
      imgIndex++;
    }
  }

  if (listOnly) {
    return { exitCode: 0, stdout: listLines.join("\n") + "\n", stderr: "" };
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
  for (const arg of argv) {
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

  for (const srcPath of sourcePaths) {
    const srcBytes = files.get(srcPath);
    if (!srcBytes) {
      return { exitCode: 1, stdout: "", stderr: `I/O Error: Couldn't open file '${srcPath}'\n` };
    }
    const srcDoc = PdfDocument.load(srcBytes);
    if (!copiedMeta) {
      copyDocumentMetadata(srcDoc, merged);
      copiedMeta = true;
    }
    const indices = Array.from({ length: srcDoc.pageCount }, (_, idx) => idx);
    merged.copyPagesFrom(srcDoc, indices);
  }

  files.set(destPath, merged.save());
  return { exitCode: 0, stdout: "", stderr: "" };
}

export async function runPdfseparateCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let firstPage = 1;
  let lastPage = 0;
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
  const srcDoc = PdfDocument.load(srcBytes);
  const endPage = lastPage > 0 ? Math.min(srcDoc.pageCount, lastPage) : srcDoc.pageCount;
  const unescapedPattern = pattern.replace(/%%/g, "");
  const hasPageSpec = /%0?\d*d/.test(unescapedPattern);
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
    const tokenized = pattern.replace(/%%/g, "\0");
    const formatted = hasPageSpec
      ? tokenized.replace(/%0?(\d*)d/, (_, pad) => String(p).padStart(Number(pad || 0), "0"))
      : tokenized;
    const outPath = formatted.replace(/\0/g, "%");
    files.set(outPath, singleDoc.save());
  }
  return { exitCode: 0, stdout: "", stderr: "" };
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

    for (const token of argv) {
      if (token.startsWith("-") && token !== "-") continue;
      if (token === "-") {
        const chunks: Uint8Array[] = [];
        let total = 0;
        for await (const chunk of readBytes(context.stdin, invocation.signal)) {
          chunks.push(chunk);
          total += chunk.byteLength;
        }
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          buf.set(c, off);
          off += c.byteLength;
        }
        vfsFiles.set("-", buf);
        continue;
      }
      try {
        const bytes = await context.fs.readFile(resolveVfsPath(token), { signal: invocation.signal });
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
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, res.stdoutBytes, invocation.signal);
    } else if (res.stdout) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }
    for (const [key, val] of vfsFiles.entries()) {
      if (key !== "-" && existingSnap.get(key) !== val) {
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

export function pdfinfoCommands(options: PdfinfoCommandOptions = {}): VirtualShellPlugin {
  const command = createPdfinfoCommand(options);
  const ppmCmd = createPdftoppmCommand(options);
  const imgCmd = createPdfimagesCommand(options);
  const uniteCmd = createPdfuniteCommand(options);
  const sepCmd = createPdfseparateCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdfinfo",
    setup(host) {
      host.commands.register(command, { replace });
      host.commands.register(ppmCmd, { replace });
      host.commands.register(imgCmd, { replace });
      host.commands.register(uniteCmd, { replace });
      host.commands.register(sepCmd, { replace });
    }
  };
}
