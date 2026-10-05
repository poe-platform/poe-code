import type { IndexedDocument } from "safe-bash-diff-engine/document";
import { Budget, ToolError } from "safe-bash-diff-engine/shared";
import type { PatchInput } from "./unified.js";

/** Replay physical patch lines without retaining a second payload or line array. */
export class StoredPatchInput implements PatchInput {
  private cachedIndex = -1;
  private cachedLine = "";
  constructor(readonly document: IndexedDocument, readonly crlf = false,
    readonly start = 0, readonly length = document.length - start) {}

  async read(index: number): Promise<string | undefined> {
    if (index < 0 || index >= this.length) return undefined;
    if (index === this.cachedIndex) return this.cachedLine;
    const line = await this.document.line(this.start + index);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let text = "";
    for await (const block of this.document.range(line.start, line.end - (this.crlf ? 2 : 1))) text += decoder.decode(block, { stream: true });
    text += decoder.decode();
    this.cachedIndex = index; this.cachedLine = text;
    return text;
  }

  async signature(index: number): Promise<boolean> {
    const line = await this.document.line(this.start + index);
    if (line.end - line.start !== (this.crlf ? 5 : 4)) return false;
    const bytes = await this.document.data.read(8 + line.start, 3);
    return bytes[0] === 45 && bytes[1] === 45 && bytes[2] === 32;
  }
}

export async function unwrapStoredPatch(document: IndexedDocument, budget: Budget): Promise<PatchInput> {
  if (document.size && (await document.data.read(8 + document.size - 1, 1))[0] !== 10) throw new ToolError("patch is truncated: missing final LF");
  let crlf = true;
  for (let index = 0; index < document.length; index++) {
    const line = await document.line(index);
    budget.step(line.end - line.start);
    const pause = budget.checkpoint(); if (pause) await pause;
    if (line.end - line.start < 2 || (await document.data.read(8 + line.end - 2, 1))[0] !== 13) { crlf = false; break; }
    if (index + 1 > budget.limits.maxLines) throw new ToolError("transport line limit exceeded");
  }
  const input = new StoredPatchInput(document, crlf);
  let start = 0;
  if (/^(?:From [0-9a-f]{40,64} |(?:From|Date|Subject|To|Cc|MIME-Version|Content-Type):)/u.test(await input.read(0) ?? "")) {
    while (start < input.length) {
      budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
      const line = (await input.read(start))!;
      if (/^(?:--- |\*\*\* |diff |\d+(?:,\d+)?[acd]\d)/u.test(line)) break;
      if (/^(?:old mode |new mode |new file mode |deleted file mode |rename |copy |similarity index |dissimilarity index |GIT binary patch|Binary files |index |@@|[+\\])/u.test(line)) throw new ToolError("unsupported or malformed mail patch metadata");
      if (++start > budget.limits.maxLines) throw new ToolError("mail preamble limit exceeded");
    }
    if (start === input.length) throw new ToolError("mail preamble without patch");
  }
  let end = input.length;
  // The original signature delimiter includes its preceding LF: a first-line
  // '-- ' is body text, while a later one begins the trailer.
  for (let index = start + 1; index < input.length; index++) {
    budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
    if (!await input.signature(index)) continue;
    end = index;
    if (input.length - index > budget.limits.maxLines) throw new ToolError("mail signature limit exceeded");
    for (index++; index < input.length; index++) {
      budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
      if (/^(?:diff |---|\+\+\+|\*\*\*|@@|index |old mode |new mode |new file mode |deleted file mode |rename |copy |similarity index |dissimilarity index |GIT binary patch|Binary files |[+\\]|\d+(?:,\d+)?[acd]\d)/u.test((await input.read(index))!)) throw new ToolError("patch data after mail signature");
    }
  }
  return new StoredPatchInput(document, crlf, start, end - start);
}
