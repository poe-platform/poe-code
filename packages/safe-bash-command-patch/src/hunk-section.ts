import { ToolError, type Budget } from "safe-bash-diff-engine/shared";
import { patchTextBytes, type PatchText } from "./patch-text.js";
import type { PatchInput } from "./unified.js";

/** Validate the grammar without materializing the optional, arbitrarily long section. */
export async function validateSection(section: PatchText, budget: Budget, message: string): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let first = true;
  for await (const bytes of patchTextBytes(section)) {
    const text = decoder.decode(bytes, { stream: true });
    if (text.length) {
      if (first && text[0] !== " " || /[\r\n\u2028\u2029]/u.test(text)) throw new ToolError(message);
      first = false;
    }
    budget.step(bytes.length); const pause = budget.checkpoint(); if (pause) await pause;
  }
  decoder.decode();
}

export async function unifiedHeader(input: PatchInput, index: number, budget: Budget): Promise<{ header: string; section: PatchText }> {
  if (!input.body) {
    const text = (await input.read(index))!;
    const end = text.indexOf("@@", 2);
    if (end < 0) return { header: text, section: "" };
    return { header: text.slice(0, end + 2), section: text.slice(end + 2) };
  }
  const source = await input.body(index, 0, true);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let header = "";
  for await (const bytes of patchTextBytes(source)) {
    const previous = header.length;
    header += decoder.decode(bytes, { stream: true });
    const end = header.indexOf("@@", Math.max(2, previous - 1));
    if (end >= 0) {
      header = header.slice(0, end + 2);
      // A valid coordinate prefix is ASCII, so its code-unit and byte offsets agree.
      if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@$/u.test(header)) throw new ToolError("malformed unified hunk header");
      return { header, section: await input.body(index, header.length, true) };
    }
    budget.step(bytes.length); const pause = budget.checkpoint(); if (pause) await pause;
  }
  return { header: header + decoder.decode(), section: "" };
}
