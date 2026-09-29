import { encoder, registerDefaultExecutor, registerDefaultExecutors, syncCommandEvaluators } from "../internal.js";
import { gnuInformationSync } from "../gnu-information.js";
import { flags } from "./diff-options.js";
import { expandTabs } from "./diff-output.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { diffCommand } from "./diff.js";
import { patchCommand } from "./patch.js";
import type { DiffPatchOptions } from "./shared.js";

export type { DiffPatchOptions } from "./shared.js";

export function createDiffPatchCommands(options: DiffPatchOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors([diffCommand(options), patchCommand(options)], options);
}

export function diffPatchCommands(options: DiffPatchOptions = {}): VirtualShellPlugin {
  return {
    name: "diff-patch-commands",
    setup(host) {
      const definitions = createDiffPatchCommands(options);
      if (!options.replace) for (const command of definitions) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of definitions) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

const syncDiffDecoder = new TextDecoder("utf-8", { fatal: false });

function normalizeSyncDiffLines(text: string, opts: ReturnType<typeof flags>): string[] {
  const rawLines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      rawLines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) rawLines.push(text.slice(start));
  const out: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i]!;
    if (opts.stripTrailingCr && line.endsWith("\r\n")) {
      line = line.slice(0, -2) + "\n";
    } else if (opts.stripTrailingCr && line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    let body = line.endsWith("\n") ? line.slice(0, -1) : line;
    if (opts.ignoreTabs) body = expandTabs(body);
    if (opts.whitespace !== "exact") {
      body = body.replace(/[ \t\v\f\r]+/gu, opts.whitespace === "all" ? "" : " ");
    }
    if (opts.ignoreTrailing || opts.whitespace !== "exact") {
      body = body.replace(/[ \t\v\f\r]+$/u, "");
    }
    if (opts.ignoreCase) {
      body = body.replace(/[A-Z]/gu, letter => letter.toLowerCase());
    }
    if (opts.ignoreBlank && body === "") continue;
    const suffix = (opts.whitespace !== "exact" || opts.ignoreTrailing || opts.ignoreTabs) ? "" : (line.endsWith("\n") ? "\n" : "");
    out.push(body + suffix);
  }
  return out;
}

export function evalSyncDiff(
  stdinBytes: Uint8Array | undefined,
  args: readonly string[],
  readFile?: (path: string) => Uint8Array | undefined,
): string | undefined {
  let opts: ReturnType<typeof flags>;
  try {
    opts = flags(args);
  } catch {
    return undefined;
  }
  const pairFiles =
    opts.fromFile !== undefined && opts.toFile === undefined && opts.files.length === 1
      ? [opts.fromFile, opts.files[0]!]
      : opts.toFile !== undefined && opts.fromFile === undefined && opts.files.length === 1
        ? [opts.files[0]!, opts.toFile]
        : opts.fromFile === undefined && opts.toFile === undefined && opts.files.length === 2
          ? [opts.files[0]!, opts.files[1]!]
          : undefined;
  if (
    !pairFiles ||
    opts.recursive ||
    opts.paginate ||
    opts.format === "side" ||
    opts.format === "ifdef" ||
    opts.format === "ed" ||
    opts.functions.length > 0 ||
    opts.excludes.length > 0 ||
    opts.excludeFiles.length > 0
  ) {
    return undefined;
  }
  const left = pairFiles[0]!;
  const right = pairFiles[1]!;
  if (left === "-" && right === "-") return opts.reportSame ? `Files ${opts.labels[0] ?? left} and ${opts.labels[1] ?? right} are identical\n` : "";
  const resolveOperand = (op: string): Uint8Array | undefined => {
    if (op === "-" || op === "/dev/stdin" || op === "/dev/fd/0") return stdinBytes;
    if (!readFile) return undefined;
    return readFile(op);
  };
  const b1 = resolveOperand(left);
  const b2 = resolveOperand(right);
  if (!b1 || !b2) return undefined;

  let same = false;
  if (b1.byteLength === b2.byteLength) {
    same = true;
    for (let i = 0; i < b1.byteLength; i++) {
      if (b1[i] !== b2[i]) {
        same = false;
        break;
      }
    }
  }
  if (!same) {
    if (opts.ignorePatterns.length === 0 && !opts.ignoreCase && !opts.ignoreTrailing && !opts.ignoreBlank && !opts.ignoreTabs && !opts.stripTrailingCr && opts.whitespace === "exact") {
      return undefined;
    }
    for (let i = 0; i < b1.byteLength; i++) if (b1[i] === 0) return undefined;
    for (let i = 0; i < b2.byteLength; i++) if (b2[i] === 0) return undefined;
    const ignoreRes: RegExp[] = [];
    for (const pat of opts.ignorePatterns) {
      try { ignoreRes.push(new RegExp(pat, opts.ignoreCase ? "i" : "")); } catch { return undefined; }
    }
    const t1 = syncDiffDecoder.decode(b1);
    const t2 = syncDiffDecoder.decode(b2);
    let l1 = normalizeSyncDiffLines(t1, opts);
    let l2 = normalizeSyncDiffLines(t2, opts);
    if (ignoreRes.length > 0) {
      l1 = l1.filter(line => !ignoreRes.some(re => re.test(line.replace(/\n$/, ""))));
      l2 = l2.filter(line => !ignoreRes.some(re => re.test(line.replace(/\n$/, ""))));
    }
    if (l1.length !== l2.length) return undefined;
    for (let i = 0; i < l1.length; i++) {
      if (l1[i] !== l2[i]) return undefined;
    }
    same = true;
  }
  return opts.reportSame ? `Files ${opts.labels[0] ?? left} and ${opts.labels[1] ?? right} are identical\n` : "";
}


export function evalSyncPatch(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean,
): string | undefined {
  const gnuInfo = gnuInformationSync("patch", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  if (!readFileSync || !writeFileSync) return undefined;
  let strip: number | undefined;
  let quiet = false;
  let inputPath: string | undefined;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (ended || !a.startsWith("-") || a === "-") {
      operands.push(a);
      continue;
    }
    if (a === "--") { ended = true; continue; }
    if (a === "-s" || a === "--quiet" || a === "--silent") { quiet = true; continue; }
    if (a === "-p" || a === "--strip") {
      const v = opArgs[++i];
      if (!v || !/^\d+$/.test(v)) return undefined;
      strip = Number(v);
      continue;
    }
    if (a.startsWith("-p") && /^\d+$/.test(a.slice(2))) {
      strip = Number(a.slice(2));
      continue;
    }
    if (a.startsWith("--strip=") && /^\d+$/.test(a.slice(8))) {
      strip = Number(a.slice(8));
      continue;
    }
    if (a === "-i" || a === "--input") {
      inputPath = opArgs[++i];
      if (!inputPath) return undefined;
      continue;
    }
    if (a.startsWith("--input=")) {
      inputPath = a.slice(8);
      continue;
    }
    return undefined;
  }
  if (operands.length > 2) return undefined;
  const targetArg = operands[0];
  const patchFileArg = inputPath ?? operands[1];
  const patchBytes = patchFileArg && patchFileArg !== "-" ? readFileSync(patchFileArg) : inBytes;
  if (!patchBytes || patchBytes.includes(0)) return undefined;
  const patchText = syncDiffDecoder.decode(patchBytes);
  const lines = patchText.split("\n");
  let headerNew: string | undefined;
  let idx = 0;
  while (idx < lines.length && !lines[idx]!.startsWith("@@ ")) {
    if (lines[idx]!.startsWith("+++ ")) {
      headerNew = lines[idx]!.slice(4).split("\t")[0]!.trim();
    }
    idx++;
  }
  if (idx >= lines.length) return undefined;
  let resolvedTarget = targetArg;
  if (!resolvedTarget) {
    if (!headerNew || headerNew === "/dev/null") return undefined;
    if (strip !== undefined) {
      const parts = headerNew.split("/");
      if (parts.length <= strip) return undefined;
      resolvedTarget = parts.slice(strip).join("/");
    } else {
      resolvedTarget = headerNew.split("/").pop() || headerNew;
    }
  }
  if (!resolvedTarget) return undefined;
  const origBytes = readFileSync(resolvedTarget);
  if (!origBytes || origBytes.includes(0)) return undefined;
  const origText = syncDiffDecoder.decode(origBytes);
  const origLines = origText === "" ? [] : (origText.endsWith("\n") ? origText.slice(0, -1).split("\n") : origText.split("\n"));
  const outLines: string[] = [];
  let origPos = 0;
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (!line.startsWith("@@ ")) {
      if (line === "") { idx++; continue; }
      return undefined;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) return undefined;
    const oldStart = Number(m[1]!) === 0 ? 0 : Number(m[1]!) - 1;
    if (oldStart < origPos || oldStart > origLines.length) return undefined;
    while (origPos < oldStart) outLines.push(origLines[origPos++]!);
    idx++;
    while (idx < lines.length && !lines[idx]!.startsWith("@@ ")) {
      const hl = lines[idx]!;
      if (hl === "" && idx === lines.length - 1) { idx++; break; }
      const prefix = hl[0];
      const body = hl.slice(1);
      if (prefix === " ") {
        if (origLines[origPos] !== body) return undefined;
        outLines.push(body);
        origPos++;
      } else if (prefix === "-") {
        if (origLines[origPos] !== body) return undefined;
        origPos++;
      } else if (prefix === "+") {
        outLines.push(body);
      } else if (hl.startsWith("\\ No newline")) {
        return undefined;
      } else {
        return undefined;
      }
      idx++;
    }
  }
  while (origPos < origLines.length) outLines.push(origLines[origPos++]!);
  const resultText = outLines.length === 0 ? "" : outLines.join("\n") + "\n";
  if (!writeFileSync(resolvedTarget, encoder.encode(resultText), false)) return undefined;
  return quiet ? "" : `patching file ${resolvedTarget}\n`;
}

syncCommandEvaluators.evalSyncPatch = evalSyncPatch;
