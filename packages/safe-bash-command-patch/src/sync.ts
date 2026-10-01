const syncDiffDecoder = new TextDecoder("utf-8", { fatal: false });
import { gnuInformationSync } from "safe-bash-io-engine/gnu-information";
import { encoder } from "safe-bash-io-engine/internal";

export type { DiffPatchOptions } from "safe-bash-diff-engine/shared";


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
  let reverse = false;
  let dryRun = false;
  let outputPath: string | undefined;
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
    if (a === "-R" || a === "--reverse") { reverse = true; continue; }
    if (a === "--dry-run") { dryRun = true; continue; }
    if (a === "-N" || a === "--forward" || a === "-f" || a === "--force" || a === "-t" || a === "--batch" || a === "-u" || a === "--unified") { continue; }
    if (a === "-o" || a === "--output") {
      outputPath = opArgs[++i];
      if (!outputPath) return undefined;
      continue;
    }
    if (a.startsWith("-o") && a.length > 2) {
      outputPath = a.slice(2);
      continue;
    }
    if (a.startsWith("--output=")) {
      outputPath = a.slice(9);
      if (!outputPath) return undefined;
      continue;
    }
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
  let headerOld: string | undefined;
  let headerNew: string | undefined;
  let idx = 0;
  while (idx < lines.length && !lines[idx]!.startsWith("@@ ")) {
    if (lines[idx]!.startsWith("--- ")) {
      headerOld = lines[idx]!.slice(4).split("\t")[0]!.trim();
    } else if (lines[idx]!.startsWith("+++ ")) {
      headerNew = lines[idx]!.slice(4).split("\t")[0]!.trim();
    }
    idx++;
  }
  if (idx >= lines.length) return undefined;
  let resolvedTarget = targetArg;
  if (!resolvedTarget) {
    const hdr = headerNew && headerNew !== "/dev/null" ? headerNew : headerOld;
    if (!hdr || hdr === "/dev/null") return undefined;
    if (strip !== undefined) {
      const parts = hdr.split("/");
      if (parts.length <= strip) return undefined;
      resolvedTarget = parts.slice(strip).join("/");
    } else {
      resolvedTarget = hdr.split("/").pop() || hdr;
    }
  }
  if (!resolvedTarget) return undefined;
  const origBytes = readFileSync(resolvedTarget);
  if (origBytes && origBytes.includes(0)) return undefined;
  const isNewFile = !origBytes && (reverse ? headerNew === "/dev/null" : headerOld === "/dev/null");
  if (!origBytes && !isNewFile) return undefined;
  const origText = origBytes ? syncDiffDecoder.decode(origBytes) : "";
  let hasTrailingNewline = origText === "" ? true : origText.endsWith("\n");
  const origLines = origText === "" ? [] : (origText.endsWith("\n") ? origText.slice(0, -1).split("\n") : origText.split("\n"));
  const outLines: string[] = [];
  let origPos = 0;
  let lastHunkOp: " " | "-" | "+" = " ";
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (!line.startsWith("@@ ")) {
      if (line === "") { idx++; continue; }
      return undefined;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) return undefined;
    const startLineNum = Number(reverse ? m[3]! : m[1]!);
    const oldStart = startLineNum === 0 ? 0 : startLineNum - 1;
    if (oldStart < origPos || oldStart > origLines.length) return undefined;
    while (origPos < oldStart) outLines.push(origLines[origPos++]!);
    idx++;
    while (idx < lines.length && !lines[idx]!.startsWith("@@ ")) {
      const hl = lines[idx]!;
      if (hl === "" && idx === lines.length - 1) { idx++; break; }
      const rawPrefix = hl[0];
      const prefix = reverse ? (rawPrefix === "+" ? "-" : rawPrefix === "-" ? "+" : rawPrefix) : rawPrefix;
      const body = hl.slice(1);
      if (prefix === " ") {
        if (origLines[origPos] !== body) return undefined;
        outLines.push(body);
        origPos++;
        lastHunkOp = " ";
      } else if (prefix === "-") {
        if (origLines[origPos] !== body) return undefined;
        origPos++;
        if (origPos === origLines.length) hasTrailingNewline = true;
        lastHunkOp = "-";
      } else if (prefix === "+") {
        outLines.push(body);
        if (origPos === origLines.length) hasTrailingNewline = true;
        lastHunkOp = "+";
      } else if (hl.startsWith("\\ No newline")) {
        if (lastHunkOp === "+" || (lastHunkOp === " " && origPos === origLines.length)) {
          hasTrailingNewline = false;
        }
      } else {
        return undefined;
      }
      idx++;
    }
  }
  while (origPos < origLines.length) outLines.push(origLines[origPos++]!);
  const resultText = outLines.length === 0 ? "" : outLines.join("\n") + (hasTrailingNewline ? "\n" : "");
  if (outputPath === "-") {
    return resultText;
  }
  const destPath = outputPath ?? resolvedTarget;
  if (!dryRun && outputPath !== "/dev/null") {
    if (!writeFileSync(destPath, encoder.encode(resultText), false)) return undefined;
  }
  if (quiet) return "";
  const verb = dryRun ? "checking" : "patching";
  const label = outputPath !== undefined ? `${outputPath} (read from ${resolvedTarget})` : resolvedTarget;
  return `${verb} file ${label}\n`;
}