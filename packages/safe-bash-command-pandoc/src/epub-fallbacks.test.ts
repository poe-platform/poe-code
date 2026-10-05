import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {epubFailure} from "./epub-xml.js";
import {EpubManifest, type ManifestItem} from "./epub-manifest.js";
import {validateEpubFallbacks} from "./epub-fallbacks.js";

const graphs = [
  ["1", "2", "3", "4", ""],
  ["", "0", "1", "1", "3"],
  ["1", "2", "1", "", ""],
  ["1", "missing", "", "", ""],
  ["2", "2", "3", "", "4"]
];
it.each(graphs.flatMap(fallbacks => [false, true].flatMap(backed => [0, 1, 2, 3, 8].map(depth => ({fallbacks, backed, depth})))))("preserves fallback errors and cached-suffix depth limits (%j)", async ({fallbacks, backed, depth}) => {
  const fs = new MemoryFileSystem(), storage = backed ? new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1) : undefined;
  const items: ManifestItem[] = fallbacks.map((fallback, ordinal) => ({ordinal, id: String(ordinal), part: ordinal + ".xhtml", media: "application/xhtml+xml", properties: [], fallback, overlay: ""}));
  const manifest = new EpubManifest(storage, async () => {});
  const ctx = new ExecutionContext("read", {limits: {depth}, yield: async () => {}}), reference = new ExecutionContext("read", {limits: {depth}, yield: async () => {}});
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  try {
    for (const item of items) await manifest.add(item);
    const expected = await (async () => {
      for (const root of items) {
        const seen = new Set<string>(); let item: ManifestItem | undefined = root, distance = 0;
        while (item?.fallback) {
          reference.checkpoint(); reference.bound("depth", ++distance);
          if (seen.has(item.id)) epubFailure(reference, item.part, "Recursive EPUB fallback dependency");
          seen.add(item.id);
          const next = items.find(candidate => candidate.id === item!.fallback);
          if (!next) epubFailure(reference, item.part, "Missing EPUB fallback item");
          item = next;
        }
      }
    })().catch(error => error);
    const actual = await validateEpubFallbacks(manifest, storage, ctx).catch(error => error);
    if (expected instanceof Error) expect(actual).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
    else expect(actual).toBeUndefined();
  } finally {await storage?.close(); await ctx.close(); await reference.close(); expect(await fs.readdir("/")).toEqual([]);}
});
