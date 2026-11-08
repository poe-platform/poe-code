import { closeDocumentResources, type IndexedDocument } from "safe-bash-diff-engine/document";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { Budget, ToolError } from "safe-bash-diff-engine/shared";
import { startIndex } from "./unified.js";
import { patchHunks, patchLine, type ReplayPatch, type ReplayApplication } from "./stored-patch.js";
import { equalTargetLines, TargetDocuments, TargetOutput, type TargetLine } from "./stored-target.js";

export async function applyStoredHunks(original: IndexedDocument, patch: ReplayPatch, fuzz: number, budget: Budget, ignoreWhitespace = false, application: ReplayApplication, documents: TargetDocuments): Promise<IndexedDocument> {
  const source = { length: original.length, at(index: number): TargetLine | undefined {
    return index >= 0 && index < original.length ? { document: original, index } : undefined;
  } };
  budget.countLines(source.length);
  const result = new TargetOutput(documents);
  const indices = new PagedStorage(budget.context, 16, documents.cache);
  try {
    let cursor = 0;
    let offset = 0;
    let outputOffset = 0;
    for await (const [hunkIndex, hunk] of patchHunks(patch)) {
      budget.step();
      const oldIndex = indices.allocate((hunk.oldCount + hunk.newCount) * 8), newIndex = oldIndex + hunk.oldCount * 8;
      let oldPosition = oldIndex, newPosition = newIndex;
      const cell = new Uint8Array(8), view = new DataView(cell.buffer);
      for (let index = 0; index < hunk.lines.length; index++) {
        view.setFloat64(0, index, true);
        const line = await patchLine(hunk, index);
        if (line.kind !== "+") { await indices.write(oldPosition, cell); oldPosition += 8; }
        if (line.kind !== "-") { await indices.write(newPosition, cell); newPosition += 8; }
        budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
      }
      const indexedLine = async (base: number, index: number) => {
        const bytes = await indices.read(base + index * 8, 8);
        return (await patchLine(hunk, new DataView(bytes.buffer).getFloat64(0, true))).text;
      };
      let leading = 0;
      let trailing = 0;
      while (leading < hunk.lines.length && (await patchLine(hunk, leading)).kind === " ") leading++;
      while (trailing < hunk.lines.length - leading && (await patchLine(hunk, hunk.lines.length - trailing - 1)).kind === " ") trailing++;
      const expected = startIndex(hunk.oldStart, hunk.oldCount) + offset;
      let found = -1;
      let misordered = false;
      let usedFuzz = 0;
      const context = Math.max(leading, trailing);
      const matches = async (position: number, prefixFuzz: number, suffixFuzz: number) => {
        budget.step();
        { const c = budget.checkpoint(); if (c) await c; }
        if (position < 0 || position > source.length - hunk.oldCount + suffixFuzz) return false;
        for (let lineIndex = 0; lineIndex < hunk.oldCount; lineIndex++) {
          if (lineIndex < prefixFuzz || lineIndex >= hunk.oldCount - suffixFuzz) continue;
          const actual = source.at(position + lineIndex);
          if (actual === undefined) return false;
          const expectedLine = await indexedLine(oldIndex, lineIndex);
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
        const retained = hunk.oldCount - Math.max(0, prefixFuzz) - suffixFuzz;
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
      await application.outcomes?.push({ hunk, index: hunkIndex + 1, failed: found < 0, misordered: found < 0 && misordered,
        line: (matched < 0 ? startIndex(hunk.oldStart, hunk.oldCount) : matched) + 1 + outputOffset,
        outputOffset, offset: matched - startIndex(hunk.oldStart, hunk.oldCount), fuzz: usedFuzz });
      if (found < 0 && application.merge && !misordered) {
        const position = Math.max(cursor, Math.min(source.length, expected));
        while (cursor < position) await result.append(source.at(cursor++)!);
        let localLength = Math.min(hunk.oldCount, source.length - cursor);
        // Without an original anchor GNU inserts the conflict before local text.
        let anchored = false;
        for (let index = 0; index < hunk.oldCount; index++) {
          if (await equalTargetLines(await indexedLine(oldIndex, index), index < localLength ? source.at(cursor + index)! : "", budget)) { anchored = true; break; }
        }
        if (!anchored) localLength = 0;
        let prefix = 0;
        let suffix = 0;
        while (prefix < Math.min(localLength, hunk.newCount, hunk.oldCount)
          && await equalTargetLines(source.at(cursor + prefix)!, await indexedLine(newIndex, prefix), budget)
          && await equalTargetLines(source.at(cursor + prefix)!, await indexedLine(oldIndex, prefix), budget)) prefix++;
        while (suffix < Math.min(localLength, hunk.newCount, hunk.oldCount) - prefix
          && await equalTargetLines(source.at(cursor + localLength - suffix - 1)!, await indexedLine(newIndex, hunk.newCount - suffix - 1), budget)
          && await equalTargetLines(source.at(cursor + localLength - suffix - 1)!, await indexedLine(oldIndex, hunk.oldCount - suffix - 1), budget)) suffix++;

        { const c = budget.checkpoint(); if (c) await c; }
        for (let index = 0; index < prefix; index++) await result.append(source.at(cursor + index)!);
        const mergeStart = result.length + 1;
        // An already applied hunk is a clean merge, not a reversal.
        let identical = localLength === hunk.newCount;
        for (let index = 0; identical && index < localLength; index++) identical = await equalTargetLines(source.at(cursor + index)!, await indexedLine(newIndex, index), budget);
        if (identical) {
          const last = await application.outcomes?.pop();
          if (last) await application.outcomes!.push({ ...last, failed: false, fuzz: 0, offset: position - startIndex(hunk.oldStart, hunk.oldCount) });
          for (let index = prefix; index < localLength - suffix; index++) await result.append(source.at(cursor + index)!);
        } else {
          await result.append("<<<<<<<\n");
          for (let index = prefix; index < localLength - suffix; index++) await result.append(source.at(cursor + index)!);
          if (application.merge === "diff3") {
            await result.append("|||||||\n");
            for (let index = prefix; index < hunk.oldCount - suffix; index++) await result.append(await indexedLine(oldIndex, index));
          }
          await result.append("=======\n");
          for (let index = prefix; index < hunk.newCount - suffix; index++) await result.append(await indexedLine(newIndex, index));
          await result.append(">>>>>>>\n");
          const last = await application.outcomes?.pop();
          if (last) await application.outcomes!.push({ ...last, mergeRange: [mergeStart, result.length] });
        }
        for (let index = localLength - suffix; index < localLength; index++) await result.append(source.at(cursor + index)!);
        cursor += localLength;
        outputOffset = result.length - cursor;
        continue;
      }
      if (found < 0) {
        if (application.partial) continue;
        throw new ToolError(`hunk ${hunkIndex + 1} does not match ${patch.oldPath}`, 1);
      }
      while (cursor < found + matchedPrefixFuzz) await result.append(source.at(cursor++)!);
      let changeStart = matchedPrefixFuzz, changeCursor = cursor;
      const flush = async (end: number) => {
        let removed = 0, added = 0;
        for (let index = changeStart; index < end; index++) {
          if ((await patchLine(hunk, index)).kind === "+") added++; else removed++;
          budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
        }
        if (!removed && !added) return;
        if (application.ifdef) {
          await result.append(`#${removed ? "ifndef" : "ifdef"} ${application.ifdef}\n`);
          let position = changeCursor;
          for (let index = changeStart; index < end; index++) if ((await patchLine(hunk, index)).kind === "-") await result.append(source.at(position++) ?? (await patchLine(hunk, index)).text);
          if (removed && added) await result.append("#else\n");
        }
        for (let index = changeStart; index < end; index++) if ((await patchLine(hunk, index)).kind === "+") await result.append((await patchLine(hunk, index)).text);
        if (application.ifdef) await result.append("#endif\n");
      };
      for (let index = matchedPrefixFuzz; index < hunk.lines.length - matchedSuffixFuzz; index++) {
        const line = (await patchLine(hunk, index));
        if (line.kind === " ") {
          await flush(index); if (cursor < source.length) await result.append(source.at(cursor++)!);
          changeStart = index + 1; changeCursor = cursor;
        } else if (line.kind === "-") cursor++;
      }
      await flush(hunk.lines.length - matchedSuffixFuzz);
      outputOffset = result.length - cursor;
    }
    while (cursor < source.length) await result.append(source.at(cursor++)!);
    return await result.finish();
  } finally { await closeDocumentResources([result, indices]); }
}
