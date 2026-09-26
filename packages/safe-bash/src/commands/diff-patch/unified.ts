import { Budget, ToolError, integer } from "./shared.js";
import { decodeHeaderPath, isEpochHeader } from "./patch-path.js";

export interface PatchLine { readonly kind: " " | "+" | "-"; text: string }
export interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: PatchLine[];
  readonly section?: string;
}
export interface FilePatch {
  readonly oldPath: string; readonly newPath: string;
  readonly oldEpoch: boolean; readonly newEpoch: boolean; readonly hunks: Hunk[];
  readonly oldHeader?: string; readonly newHeader?: string;
  readonly indexPath?: string;
  readonly unlocated?: boolean;
  readonly format?: "unified" | "normal" | "context";
}

function header(line: string, prefix: string): string {
  if (!line.startsWith(prefix)) throw new ToolError(`expected ${prefix.trim()} file header`);
  const path = decodeHeaderPath(line.slice(prefix.length));
  if (!path || /[\0\r\n]/u.test(path)) throw new ToolError("unsupported or empty patch filename");
  return path;
}

export function startIndex(start: number, count: number): number { return count === 0 ? start : start - 1; }

export interface UnifiedCursor { readonly lines: readonly string[]; index: number }

export async function parseUnified(text: string, budget: Budget): Promise<FilePatch[]> {
  if (text && !text.endsWith("\n")) throw new ToolError("patch is truncated: missing final LF");
  return parseUnifiedReader({ lines: budget.split(text).map(line => line.slice(0, -1)), index: 0 }, budget, false);
}

export async function parseUnifiedSection(cursor: UnifiedCursor, budget: Budget): Promise<FilePatch[]> {
  return parseUnifiedReader(cursor, budget, true);
}

async function parseUnifiedReader(cursor: UnifiedCursor, budget: Budget, single: boolean): Promise<FilePatch[]> {
  const physical = cursor.lines;
  const patches: FilePatch[] = [];
  let index = cursor.index;
  let pendingMetadata = false;
  while (index < physical.length) {
    budget.step();
    { const c = budget.checkpoint(); if (c) await c; }
    const line = physical[index]!;
    if (line === "") { index++; continue; }
    if (/^diff (?:--git |-[^ ]+ )/u.test(line) || /^index [0-9a-f]+\.\.[0-9a-f]+(?: 100(?:644|755))?$/u.test(line)
      || /^(?:new file|deleted file) mode 100(?:644|755)$/u.test(line)) {
      pendingMetadata = true;
      index++;
      continue;
    }
    const oldPath = header(line, "--- ");
    const oldHeader = line.slice(4);
    const oldEpoch = isEpochHeader(line);
    const newPath = header(physical[++index] ?? "", "+++ ");
    const newHeader = physical[index]!.slice(4);
    const newEpoch = isEpochHeader(physical[index]!);
    index++;
    budget.file();
    const hunks: Hunk[] = [];
    let oldEnded = false;
    let newEnded = false;
    while (index < physical.length && physical[index]!.startsWith("@@")) {
      budget.hunk();
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@( .*)?$/u.exec(physical[index++]!);
      if (!match) throw new ToolError("malformed unified hunk header");
      const oldStart = integer(match[1]!, "old start");
      const oldCount = integer(match[2] ?? "1", "old count");
      const newStart = integer(match[3]!, "new start");
      const newCount = integer(match[4] ?? "1", "new count");
      for (const value of [oldStart, oldCount, newStart, newCount]) {
        if (value > budget.limits.maxLines) throw new ToolError("hunk coordinate exceeds line limit");
      }
      if ((oldCount > 0 && oldStart === 0) || (newCount > 0 && newStart === 0) || (!oldCount && !newCount)) throw new ToolError("invalid zero hunk range");
      if ((oldEnded && oldCount) || (newEnded && newCount)) throw new ToolError("hunk follows an incomplete final line");
      let oldRead = 0;
      let newRead = 0;
      const lines: PatchLine[] = [];
      let changed = false;
      while (oldRead < oldCount || newRead < newCount) {
        budget.step();
        { const c = budget.checkpoint(); if (c) await c; }
        const body = physical[index++];
        const kind = body === "" ? " " : body?.[0];
        if (body === undefined || (kind !== " " && kind !== "+" && kind !== "-")) throw new ToolError("truncated or malformed hunk body");
        if ((kind !== "+" && oldEnded) || (kind !== "-" && newEnded)) throw new ToolError("content follows an incomplete final line");
        if (kind !== "+") oldRead++;
        if (kind !== "-") newRead++;
        if (oldRead > oldCount || newRead > newCount) throw new ToolError("hunk line counts do not match header");
        const entry: PatchLine = { kind, text: `${body.slice(1)}\n` };
        lines.push(entry);
        changed ||= kind !== " ";
        if (physical[index] === "\\ No newline at end of file") {
          if (entry.text === "\n") throw new ToolError("empty incomplete line is not a valid text line");
          index++;
          entry.text = entry.text.slice(0, -1);
          if (kind !== "+") oldEnded = true;
          if (kind !== "-") newEnded = true;
        }
      }
      if (!changed) throw new ToolError("hunk has no changes");
      hunks.push({ oldStart, oldCount, newStart, newCount, lines, section: match[5] ?? "" });
    }
    if (!hunks.length) throw new ToolError("file patch has no hunks");
    patches.push({ oldPath, newPath, oldEpoch, newEpoch, oldHeader, newHeader, hunks });
    pendingMetadata = false;
    if (single) break;
  }
  if (pendingMetadata) throw new ToolError("metadata without a file patch");
  cursor.index = index;
  return patches;
}

export function reversePatch(patch: FilePatch): FilePatch {
  return {
    ...patch,
    oldPath: patch.newPath, newPath: patch.oldPath,
    oldEpoch: patch.newEpoch, newEpoch: patch.oldEpoch,
    hunks: patch.hunks.map(hunk => ({
      ...hunk,
      oldStart: hunk.newStart, oldCount: hunk.newCount, newStart: hunk.oldStart, newCount: hunk.oldCount,
      lines: hunk.lines.map(line => ({ kind: line.kind === "+" ? "-" : line.kind === "-" ? "+" : " ", text: line.text })),
    })),
  };
}

export interface HunkOutcome {
  readonly hunk: Hunk; readonly index: number; readonly failed: boolean;
  readonly mergeRange?: readonly [number, number];
  readonly misordered: boolean;
  readonly line: number; readonly outputOffset: number; readonly offset: number; readonly fuzz: number;
}

export interface HunkApplication {
  readonly ifdef?: string;
  readonly merge?: "merge" | "diff3";
  readonly partial?: boolean;
  readonly rejectAll?: boolean;
  readonly outcomes?: HunkOutcome[];
}

export async function applyHunks(original: string, patch: FilePatch, fuzz: number, budget: Budget, ignoreWhitespace = false, application: HunkApplication = {}): Promise<string> {
  const source = budget.split(original);
  const result: string[] = [];
  let resultBytes = 0;
  const append = (line: string) => {
    resultBytes += Buffer.byteLength(line);
    if (resultBytes > budget.limits.maxOutputBytes) throw new ToolError("output byte limit exceeded");
    result.push(line);
  };
  let cursor = 0;
  let offset = 0;
  let outputOffset = 0;
  for (const [hunkIndex, hunk] of patch.hunks.entries()) {
    budget.step();
    const oldLines = hunk.lines.filter(line => line.kind !== "+");
    let leading = 0;
    let trailing = 0;
    while (leading < hunk.lines.length && hunk.lines[leading]!.kind === " ") leading++;
    while (trailing < hunk.lines.length - leading && hunk.lines[hunk.lines.length - trailing - 1]!.kind === " ") trailing++;
    const expected = startIndex(hunk.oldStart, hunk.oldCount) + offset;
    let found = -1;
    let misordered = false;
    let usedFuzz = 0;
    const context = Math.max(leading, trailing);
    const matches = async (position: number, prefixFuzz: number, suffixFuzz: number) => {
      budget.step();
      { const c = budget.checkpoint(); if (c) await c; }
      if (position < 0 || position > source.length - hunk.oldCount + suffixFuzz) return false;
      for (let lineIndex = 0; lineIndex < oldLines.length; lineIndex++) {
        if (lineIndex < prefixFuzz || lineIndex >= oldLines.length - suffixFuzz) continue;
        const actual = source[position + lineIndex];
        if (actual === undefined) return false;
        const expectedLine = oldLines[lineIndex]!.text;
        if (ignoreWhitespace) budget.step(actual.length + expectedLine.length);
        if (!budget.equal(ignoreWhitespace ? actual.replace(/[ \t]+(?=\r?\n|$)/gu, "").replace(/[ \t]+/gu, " ") : actual,
          ignoreWhitespace ? expectedLine.replace(/[ \t]+(?=\r?\n|$)/gu, "").replace(/[ \t]+/gu, " ") : expectedLine)) return false;
        { const c = budget.checkpoint(); if (c) await c; }
      }
      if (position < cursor) misordered = true;
      return true;
    };
    let matchedPrefixFuzz = 0;
    let matchedSuffixFuzz = 0;
    for (let tolerance = 0; tolerance <= Math.min(fuzz, context); tolerance++) {
      if (application.rejectAll) break;
      usedFuzz = tolerance;
      const prefixFuzz = tolerance + leading - context;
      const suffixFuzz = tolerance + trailing - context;
      if (prefixFuzz < 0 && hunk.oldStart <= 1) {
        if (await matches(0, 0, suffixFuzz)) { found = 0; matchedPrefixFuzz = 0; matchedSuffixFuzz = suffixFuzz; }
        if (found >= 0) break;
        continue;
      }
      if (suffixFuzz < 0) {
        const end = source.length - hunk.oldCount;
        if (await matches(end, Math.max(0, prefixFuzz), 0)) { found = end; matchedPrefixFuzz = Math.max(0, prefixFuzz); matchedSuffixFuzz = 0; }
        if (found >= 0) break;
        continue;
      }
      const retained = oldLines.length - Math.max(0, prefixFuzz) - suffixFuzz;
      if (retained === 0) {
        if (await matches(expected, Math.max(0, prefixFuzz), suffixFuzz)) { found = expected; matchedPrefixFuzz = Math.max(0, prefixFuzz); matchedSuffixFuzz = suffixFuzz; break; }
        continue;
      }
      const maximum = source.length - hunk.oldCount + suffixFuzz;
      const positiveLimit = maximum - expected;
      const negativeLimit = Math.min(expected - cursor, expected);
      const distanceLimit = Math.max(positiveLimit, negativeLimit);
      const firstDistance = positiveLimit < 0 ? -positiveLimit : negativeLimit < 0 ? negativeLimit : 0;
      for (let distance = firstDistance; distance <= distanceLimit; distance++) {
        if (distance <= positiveLimit && await matches(expected + distance, Math.max(0, prefixFuzz), suffixFuzz)) { found = expected + distance; matchedPrefixFuzz = Math.max(0, prefixFuzz); matchedSuffixFuzz = suffixFuzz; break; }
        if (distance <= negativeLimit && await matches(expected - distance, Math.max(0, prefixFuzz), suffixFuzz)) { found = expected - distance; matchedPrefixFuzz = Math.max(0, prefixFuzz); matchedSuffixFuzz = suffixFuzz; break; }
      }
      if (found >= 0) break;
    }
    const matched = found;
    if (matched >= 0) offset = matched - startIndex(hunk.oldStart, hunk.oldCount);
    if (misordered) found = -1;
    application.outcomes?.push({ hunk, index: hunkIndex + 1, failed: found < 0, misordered: found < 0 && misordered,
      line: (matched < 0 ? startIndex(hunk.oldStart, hunk.oldCount) : matched) + 1 + outputOffset,
      outputOffset, offset: matched - startIndex(hunk.oldStart, hunk.oldCount), fuzz: usedFuzz });
    if (found < 0 && application.merge && !misordered) {
      const position = Math.max(cursor, Math.min(source.length, expected));
      while (cursor < position) append(source[cursor++]!);
      let local = source.slice(cursor, cursor + hunk.oldCount);
      // Without an original anchor GNU inserts the conflict before local text.
      if (!oldLines.some((line, index) => budget.equal(line.text, local[index] ?? ""))) local = [];
      const incoming = hunk.lines.filter(line => line.kind !== "-").map(line => line.text);
      const base = oldLines.map(line => line.text);
      let prefix = 0;
      let suffix = 0;
      while (prefix < Math.min(local.length, incoming.length, base.length)
        && local[prefix] === incoming[prefix] && local[prefix] === base[prefix]) prefix++;
      while (suffix < Math.min(local.length, incoming.length, base.length) - prefix
        && local[local.length - suffix - 1] === incoming[incoming.length - suffix - 1]
        && local[local.length - suffix - 1] === base[base.length - suffix - 1]) suffix++;
      budget.step(local.join("").length + incoming.join("").length + base.join("").length);
      { const c = budget.checkpoint(); if (c) await c; }
      for (const line of local.slice(0, prefix)) append(line);
      const mergeStart = result.length + 1;
      // An already applied hunk is a clean merge, not a reversal.
      if (local.join("") === incoming.join("")) {
        const last = application.outcomes?.pop();
        if (last) application.outcomes!.push({ ...last, failed: false, fuzz: 0, offset: position - startIndex(hunk.oldStart, hunk.oldCount) });
        for (const line of local.slice(prefix, local.length - suffix)) append(line);
      } else {
        append("<<<<<<<\n");
        for (const line of local.slice(prefix, local.length - suffix)) append(line);
        if (application.merge === "diff3") {
          append("|||||||\n");
          for (const line of base.slice(prefix, base.length - suffix)) append(line);
        }
        append("=======\n");
        for (const line of incoming.slice(prefix, incoming.length - suffix)) append(line);
        append(">>>>>>>\n");
        const last = application.outcomes?.pop();
        if (last) application.outcomes!.push({ ...last, mergeRange: [mergeStart, result.length] });
      }
      for (const line of local.slice(local.length - suffix)) append(line);
      cursor += local.length;
      outputOffset = result.length - cursor;
      continue;
    }
    if (found < 0) {
      if (application.partial) continue;
      throw new ToolError(`hunk ${hunkIndex + 1} does not match ${patch.oldPath}`, 1);
    }
    while (cursor < found + matchedPrefixFuzz) append(source[cursor++]!);
    let removed: string[] = [];
    let added: string[] = [];
    const flush = () => {
      if (!removed.length && !added.length) return;
      if (application.ifdef) {
        append(`#${removed.length ? "ifndef" : "ifdef"} ${application.ifdef}\n`);
        for (const text of removed) append(text);
        if (removed.length && added.length) append("#else\n");
        for (const text of added) append(text);
        append("#endif\n");
      } else for (const text of added) append(text);
      removed = []; added = [];
    };
    for (const line of hunk.lines.slice(matchedPrefixFuzz, hunk.lines.length - matchedSuffixFuzz)) {
      if (line.kind === "+") added.push(line.text);
      else if (line.kind === " ") { flush(); if (cursor < source.length) append(source[cursor++]!); }
      else { removed.push(source[cursor] ?? line.text); cursor++; }
    }
    flush();
    outputOffset = result.length - cursor;
  }
  while (cursor < source.length) append(source[cursor++]!);
  for (let index = 0; index < result.length - 1; index++) {
    budget.step();
    if (!result[index]!.endsWith("\n")) {
      // An incomplete patch record only stays unterminated at the target EOF.
      if (++resultBytes > budget.limits.maxOutputBytes) throw new ToolError("output byte limit exceeded");
      result[index] += "\n";
    }
    { const c = budget.checkpoint(); if (c) await c; }
  }
  const text = result.join("");
  budget.output(text);
  return text;
}
