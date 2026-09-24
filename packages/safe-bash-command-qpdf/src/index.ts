import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import {
  PdfDocument,
  parseCosDocument,
  serializeCosDocument,
  encryptCosDocument,
  decodePdfString,
  cosDict,
  cosNumber,
  dictGet,
  dictDelete,
  type PdfCosNode,
  type PdfCosDict
} from "@poe-code/pdf-ast";

const asDict = (n: PdfCosNode | undefined): PdfCosDict | undefined => (n?.kind === "dict" ? n : undefined);
const asArray = (n: PdfCosNode | undefined) => (n?.kind === "array" ? n : undefined);
const asNumber = (n: PdfCosNode | undefined) => (n?.kind === "number" ? n : undefined);
const asName = (n: PdfCosNode | undefined) => (n?.kind === "name" ? n : undefined);
const asRef = (n: PdfCosNode | undefined) => (n?.kind === "ref" ? n : undefined);

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
  let spec = rangeSpec.trim();
  let parity: "odd" | "even" | undefined;
  if (spec.endsWith(":odd")) {
    parity = "odd";
    spec = spec.slice(0, -4);
  } else if (spec.endsWith(":even")) {
    parity = "even";
    spec = spec.slice(0, -5);
  }

  const expandSubRange = (part: string): number[] => {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-", 2);
      const start = parseSingleTokenPageNumber(startStr ?? "1", totalPages);
      const end = parseSingleTokenPageNumber(endStr ?? "z", totalPages);
      const out: number[] = [];
      if (start <= end) {
        for (let p = start; p <= end; p++) out.push(p);
      } else {
        for (let p = start; p >= end; p--) out.push(p);
      }
      return out;
    }
    return [parseSingleTokenPageNumber(part, totalPages)];
  };

  let pages: number[] = [];
  const parts = spec.split(",").filter((s) => s.length > 0);
  for (const part of parts) {
    if (part.startsWith("x")) {
      const excluded = new Set(expandSubRange(part.slice(1)));
      pages = pages.filter((p) => !excluded.has(p));
    } else {
      pages.push(...expandSubRange(part));
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

interface EncryptConfig {
  userPassword: string;
  ownerPassword: string;
  keyLength: number;
  print: boolean;
  modify: boolean;
  copy: boolean;
  addNotes: boolean;
}

export async function runQpdfCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
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
  let jsonVersion: number | undefined;
  let emptyInput = false;
  let replaceInput = false;
  let qdf = false;
  let streamDataMode: "uncompress" | "compress" | "preserve" = "preserve";
  let decrypt = false;
  let password: string | undefined;
  let splitPagesGroup: number | undefined;
  let collateCount: number | undefined;
  let linearize = false;
  let flattenAnnotations: false | "all" | "print" | "screen" = false;
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
    } else if (arg === "--show-npages") {
      showNpages = true;
    } else if (arg === "--show-pages") {
      showPages = true;
    } else if (arg === "--with-images") {
      withImages = true;
    } else if (arg === "--linearize") {
      linearize = true;
    } else if (arg === "--collate") {
      collateCount = 1;
    } else if (arg.startsWith("--collate=")) {
      collateCount = Math.max(1, Number.parseInt(arg.slice("--collate=".length), 10) || 1);
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
    } else if (arg === "--json") {
      jsonVersion = 2;
    } else if (arg.startsWith("--json=")) {
      jsonVersion = Number.parseInt(arg.slice("--json=".length), 10) || 2;
    } else if (arg === "--empty") {
      emptyInput = true;
    } else if (arg === "--replace-input") {
      replaceInput = true;
    } else if (arg === "--qdf") {
      qdf = true;
      streamDataMode = "uncompress";
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
      const [anglePart, rangePart] = spec.split(":", 2);
      const rawAngle = anglePart ?? "0";
      const relative = rawAngle.startsWith("+") || rawAngle.startsWith("-");
      const sign: 1 | -1 = rawAngle.startsWith("-") ? -1 : 1;
      const absDeg = ((Math.abs(Number.parseInt(rawAngle, 10)) % 360) as 0 | 90 | 180 | 270);
      rotateSpecs.push({
        angle: absDeg,
        relative,
        sign,
        range: rangePart ?? "1-z"
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
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  const inputFile = emptyInput ? undefined : positional[0];
  const outputFile = emptyInput ? positional[0] : positional[1];

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

  // Inspection modes
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
    for (let idx = 0; idx < pages.length; idx++) {
      const p = pages[idx]!;
      lines.push(`page ${idx + 1}: ${p.ref.objectNumber} ${p.ref.generationNumber} R`);
      if (withImages) {
        lines.push("  images:");
        const resDict = asDict(baseDoc.cos.resolve(dictGet(p.dict, "Resources")));
        const xobjDict = resDict ? asDict(baseDoc.cos.resolve(dictGet(resDict, "XObject"))) : undefined;
        if (xobjDict) {
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
            }
          }
        }
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
    for (const [objNum, obj] of [...baseDoc.cos.objects.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`${objNum}/${obj.generationNumber}: uncompressed; type = ${obj.value.kind}`);
    }
    return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  if (showObject) {
    const node = baseDoc.cos.getObject(showObject.objNum);
    return { exitCode: 0, stdout: formatCosNodeForDisplay(node) + "\n", stderr: "" };
  }

  if (jsonVersion !== undefined) {
    const objectsMap: Record<string, unknown> = {};
    for (const [objNum, obj] of baseDoc.cos.objects.entries()) {
      objectsMap[`obj:${objNum} ${obj.generationNumber} R`] = {
        value: cosNodeToJson(obj.value)
      };
    }
    const payload =
      jsonVersion === 1
        ? {
            version: 1,
            pdfversion: baseDoc.cos.version,
            pages: baseDoc.getPageCount(),
            objects: objectsMap
          }
        : {
            version: 2,
            qpdf: [
              {
                pdfversion: baseDoc.cos.version,
                maxobjectid: baseDoc.cos.maxObjectNumber,
                pages: baseDoc.getPageCount()
              },
              objectsMap
            ]
          };
    return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) + "\n", stderr: "" };
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
        const stampStream = srcStampPage.getRawContentStream();

        // Merge stamp stream into target stream wrapped in q ... Q
        const qOpen = enc.encode("q\n");
        const qClose = enc.encode("\nQ\n");
        const firstPart = stamp.mode === "underlay" ? stampStream : targetStream;
        const secondPart = stamp.mode === "underlay" ? targetStream : stampStream;
        const merged = new Uint8Array(
          qOpen.length * 2 + qClose.length * 2 + firstPart.length + secondPart.length
        );
        let pos = 0;
        merged.set(qOpen, pos); pos += qOpen.length;
        merged.set(firstPart, pos); pos += firstPart.length;
        merged.set(qClose, pos); pos += qClose.length;
        merged.set(qOpen, pos); pos += qOpen.length;
        merged.set(secondPart, pos); pos += secondPart.length;
        merged.set(qClose, pos);
        targetPage.setRawContentStream(merged);
      }
    }
  }

  // Apply --flatten-annotations
  if (flattenAnnotations !== false) {
    for (const page of workingDoc.getPages()) {
      const annotsNode = workingDoc.cos.resolve(dictGet(page.dict, "Annots"));
      const annotsArr = asArray(annotsNode);
      if (!annotsArr) continue;
      for (const item of annotsArr.items) {
        const annotDict = asDict(workingDoc.cos.resolve(item));
        if (!annotDict) continue;
        const subtype = asName(dictGet(annotDict, "Subtype"))?.decoded;
        if (subtype === "Link") continue;
        const contentsNode = dictGet(annotDict, "Contents");
        const text =
          contentsNode?.kind === "string" ? decodePdfString(contentsNode).trim() : "";
        const rectArr = asArray(dictGet(annotDict, "Rect"));
        const x = asNumber(rectArr?.items[0])?.value ?? 72;
        const y = asNumber(rectArr?.items[1])?.value ?? 72;
        if (text.length > 0) {
          page.drawText(text, { x, y, size: 10 });
        }
      }
      dictDelete(page.dict, "Annots");
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
    const baseStem = finalTarget.replace(/\.pdf$/i, "");
    for (let startIdx = 0; startIdx < total; startIdx += splitPagesGroup) {
      const endIdx = Math.min(total - 1, startIdx + splitPagesGroup - 1);
      const subDoc = PdfDocument.create();
      const indices: number[] = [];
      for (let k = startIdx; k <= endIdx; k++) indices.push(k);
      subDoc.copyPagesFrom(workingDoc, indices);
      const suffix =
        splitPagesGroup === 1 ? `${startIdx + 1}` : `${startIdx + 1}-${endIdx + 1}`;
      const splitName = finalTarget.includes("%d")
        ? finalTarget.replace("%d", suffix)
        : `${baseStem}-${suffix}.pdf`;
      files.set(splitName, subDoc.save({ normalizeContent: qdf }));
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  // Save final PDF
  let outBytes = workingDoc.save({
    normalizeContent: qdf || streamDataMode === "uncompress"
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

    for (const token of argv) {
      let candidate = token;
      if (token.startsWith("--overlay=") || token.startsWith("--underlay=")) {
        candidate = token.slice(token.indexOf("=") + 1);
      } else if (token.startsWith("-") || token === "--" || token === ".") {
        continue;
      }
      const abs = resolveVfsPath(candidate);
      try {
        const bytes = await context.fs.readFile(abs, { signal: invocation.signal });
        vfsFiles.set(candidate, bytes);
      } catch {
        // Might be an output file or range spec
      }
    }

    const existingSnap = new Map(vfsFiles);
    const res = await runQpdfCli(argv, vfsFiles);

    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdout) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }

    for (const [fileKey, fileBytes] of vfsFiles.entries()) {
      if (existingSnap.get(fileKey) !== fileBytes) {
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
