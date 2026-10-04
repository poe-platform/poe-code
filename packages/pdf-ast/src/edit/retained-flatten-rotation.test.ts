import { it, expect } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosDict, cosNumber, cosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { flattenRetainedRotations } from "./retained-flatten-rotation.js";

it.each(["producer", "cancel"])("cleans flattened content staging after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" };
  const store = new PdfMutableObjectStore(storage), ref = await store.allocate(cosDict({ Rotate: cosNumber(90), Contents: cosRef(9) }));
  const page = (await store.get(ref.objectNumber))!;
  const before = await fs.readdir("/scratch"), controller = new AbortController(), reason = new Error("Content production failed");
  const document = {
    async lookup() { return undefined; },
    async *pages() { yield { reference: ref, dict: page.value, async attributes() { return { rotation: 90, mediaBox: [0, 0, 100, 200] }; },
      async *streamContents() { yield new Uint8Array(65536); if (mode === "cancel") controller.abort(reason); throw reason; } }; },
  } as unknown as PdfRetainedDocument;
  try {
    await expect(flattenRetainedRotations(document, store, storage, controller.signal)).rejects.toBe(reason);
    expect(await fs.readdir("/scratch")).toEqual(before);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
