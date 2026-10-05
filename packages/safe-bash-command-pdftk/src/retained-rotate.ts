import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { PdfMutableObjectStore, RetainedPageRotation } from "@poe-code/pdf-ast";
import { iteratePdftkRangeToken } from "./index.js";

/** PDFtk keeps only the final selection for each page, then edits in page order. */
export async function* retainedRotations(args: readonly string[], handles: ReadonlyMap<string, { readonly pageCount: number }>, primaryHandle: string, pageCount: number, storage: ConstructorParameters<typeof PdfMutableObjectStore>[0], signal: AbortSignal): AsyncGenerator<RetainedPageRotation, void, void> {
  const records = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const base = records.allocate(pageCount * 16); let failed = false, work = 0;
  try {
    for (const arg of args) for (const selection of iteratePdftkRangeToken(arg, handles, primaryHandle)) {
      signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!selection.rotation || selection.pageNumber > pageCount) continue;
      const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
      view.setFloat64(0, selection.rotation.kind === "relative" ? 2 : 1); view.setFloat64(8, selection.rotation.degrees);
      await records.write(base + (selection.pageNumber - 1) * 16, bytes);
    }
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const bytes = await records.read(base + pageIndex * 16, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), kind = view.getFloat64(0);
      if (kind) yield { pageIndex, degrees: view.getFloat64(8), relative: kind === 2 };
    }
  } catch (error) { failed = true; throw error; }
  finally { await records.close().catch(error => { if (!failed) throw error; }); }
}
