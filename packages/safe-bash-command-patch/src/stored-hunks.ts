import type { IndexedDocument } from "safe-bash-diff-engine/document";
import { Budget, ToolError } from "safe-bash-diff-engine/shared";
import { startIndex, type FilePatch, type HunkApplication } from "./unified.js";
import { equalTargetLines, TargetDocuments, TargetOutput, type TargetLine } from "./stored-target.js";

export async function applyStoredHunks(original: IndexedDocument, patch: FilePatch, fuzz: number, budget: Budget, ignoreWhitespace = false, application: HunkApplication, documents: TargetDocuments): Promise<IndexedDocument> {
  const source = { length: original.length, at(index: number): TargetLine | undefined {
    return index >= 0 && index < original.length ? { document: original, index } : undefined;
  } };
  budget.countLines(source.length);
  const result = new TargetOutput(documents);
  try {
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
          const actual = source.at(position + lineIndex);
          if (actual === undefined) return false;
          const expectedLine = oldLines[lineIndex]!.text;
          if (!await equalTargetLines(actual, expectedLine, budget, ignoreWhitespace)) return false;
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
        while (cursor < position) await result.append(source.at(cursor++)!);
        let local = Array.from({ length: Math.min(hunk.oldCount, source.length - cursor) }, (_, index) => source.at(cursor + index)!);
        // Without an original anchor GNU inserts the conflict before local text.
        let anchored = false;
        for (let index = 0; index < oldLines.length; index++) {
          if (await equalTargetLines(oldLines[index]!.text, local[index] ?? "", budget)) { anchored = true; break; }
        }
        if (!anchored) local = [];
        const incoming = hunk.lines.filter(line => line.kind !== "-").map(line => line.text);
        const base = oldLines.map(line => line.text);
        let prefix = 0;
        let suffix = 0;
        while (prefix < Math.min(local.length, incoming.length, base.length)
          && await equalTargetLines(local[prefix]!, incoming[prefix]!, budget) && await equalTargetLines(local[prefix]!, base[prefix]!, budget)) prefix++;
        while (suffix < Math.min(local.length, incoming.length, base.length) - prefix
          && await equalTargetLines(local[local.length - suffix - 1]!, incoming[incoming.length - suffix - 1]!, budget)
          && await equalTargetLines(local[local.length - suffix - 1]!, base[base.length - suffix - 1]!, budget)) suffix++;

        { const c = budget.checkpoint(); if (c) await c; }
        for (const line of local.slice(0, prefix)) await result.append(line);
        const mergeStart = result.length + 1;
        // An already applied hunk is a clean merge, not a reversal.
        let identical = local.length === incoming.length;
        for (let index = 0; identical && index < local.length; index++) identical = await equalTargetLines(local[index]!, incoming[index]!, budget);
        if (identical) {
          const last = application.outcomes?.pop();
          if (last) application.outcomes!.push({ ...last, failed: false, fuzz: 0, offset: position - startIndex(hunk.oldStart, hunk.oldCount) });
          for (const line of local.slice(prefix, local.length - suffix)) await result.append(line);
        } else {
          await result.append("<<<<<<<\n");
          for (const line of local.slice(prefix, local.length - suffix)) await result.append(line);
          if (application.merge === "diff3") {
            await result.append("|||||||\n");
            for (const line of base.slice(prefix, base.length - suffix)) await result.append(line);
          }
          await result.append("=======\n");
          for (const line of incoming.slice(prefix, incoming.length - suffix)) await result.append(line);
          await result.append(">>>>>>>\n");
          const last = application.outcomes?.pop();
          if (last) application.outcomes!.push({ ...last, mergeRange: [mergeStart, result.length] });
        }
        for (const line of local.slice(local.length - suffix)) await result.append(line);
        cursor += local.length;
        outputOffset = result.length - cursor;
        continue;
      }
      if (found < 0) {
        if (application.partial) continue;
        throw new ToolError(`hunk ${hunkIndex + 1} does not match ${patch.oldPath}`, 1);
      }
      while (cursor < found + matchedPrefixFuzz) await result.append(source.at(cursor++)!);
      let removed: TargetLine[] = [];
      let added: string[] = [];
      const flush = async () => {
        if (!removed.length && !added.length) return;
        if (application.ifdef) {
          await result.append(`#${removed.length ? "ifndef" : "ifdef"} ${application.ifdef}\n`);
          for (const text of removed) await result.append(text);
          if (removed.length && added.length) await result.append("#else\n");
          for (const text of added) await result.append(text);
          await result.append("#endif\n");
        } else for (const text of added) await result.append(text);
        removed = []; added = [];
      };
      for (const line of hunk.lines.slice(matchedPrefixFuzz, hunk.lines.length - matchedSuffixFuzz)) {
        if (line.kind === "+") added.push(line.text);
        else if (line.kind === " ") { await flush(); if (cursor < source.length) await result.append(source.at(cursor++)!); }
        else { removed.push(source.at(cursor) ?? line.text); cursor++; }
      }
      await flush();
      outputOffset = result.length - cursor;
    }
    while (cursor < source.length) await result.append(source.at(cursor++)!);
    return await result.finish();
  } finally { await result.close(); }
}
