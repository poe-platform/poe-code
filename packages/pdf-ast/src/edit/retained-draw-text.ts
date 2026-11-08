import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosNumber, cosString } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { parseContentRangeEvents } from "../content/range-events.js";
import type { PdfContentEvent } from "../content/parser.js";
import { serializeContentEventChunks } from "../content/serializer.js";
import { encodeWinAnsiChar } from "../fonts/standard14.js";
import type { PdfRetainedPage } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import type { RetainedContentEditor } from "./retained-content-edit.js";

/** Match default canvas text drawing without retaining the existing content AST. */
export async function drawRetainedAnnotationText(page: PdfRetainedPage, editor: RetainedContentEditor, storage: PdfIndexStorage,
  text: string, x: number, y: number, isolated: boolean, font: () => Promise<string>, signal: AbortSignal): Promise<void> {
  const source = await PdfFileSource.fromStream(storage.fs, storage.directory, page.streamContents(), { signal });
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  let failed = false;
  try {
    const name = await font(), position = backing.allocate(text.length);
    const bytes = new Uint8Array(4096); let used = 0, length = 0;
    for (const character of text) {
      signal.throwIfAborted(); bytes[used++] = encodeWinAnsiChar(character);
      if (used === bytes.length) { await backing.write(position + length, bytes); length += used; used = 0; if (length % 262144 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    }
    if (used) { await backing.write(position + length, bytes.subarray(0, used)); length += used; }
    const token = { ...cosString(new Uint8Array()), storedBytes: { storage: backing, position, byteLength: length } };
    async function* events(): AsyncGenerator<PdfContentEvent> {
      let depth = 0, started = false;
      for await (const event of parseContentRangeEvents(source, storage, { pathStorage: backing, signal })) {
        // The buffered AST drops unmatched closing groups and closes open groups
        // before the new text node. Preserve that behavior inside the isolation.
        if (event.kind === "end-group" && depth === 0) continue;
        if (!started) { started = true; if (!isolated) yield { kind: "begin-group", group: { kind: "graphics-group", ops: [] } }; }
        if (event.kind === "begin-group") depth++;
        else if (event.kind === "end-group") depth--;
        yield event;
      }
      while (depth-- > 0) yield { kind: "end-group" };
      if (started && !isolated) yield { kind: "end-group" };
      yield { kind: "graphics-group", ops: [
        { kind: "state-op", operator: "rg", operands: [cosNumber(0), cosNumber(0), cosNumber(0)] },
        { kind: "text-object", commands: [
          { kind: "font", fontName: name, size: 10 }, { kind: "matrix", matrix: [1, 0, 0, 1, x, y] }, { kind: "show-text", token },
        ] },
      ] };
    }
    await editor.replace(page, serializeContentEventChunks(events(), storage, { signal }));
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([source.close(), backing.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
