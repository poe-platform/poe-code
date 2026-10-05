import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {EpubManifest, ManifestItem} from "./epub-manifest.js";
import {epubFailure} from "./epub-xml.js";
import type {AdapterContext} from "./types.js";

/** Each edge is followed at most twice. Marks are unseen (0), active (1), or
 * completed suffix length + 2. Replaying the active prefix to finish its marks
 * avoids both a resident path stack and repeated walks of shared suffixes. */
export async function validateEpubFallbacks(manifest: EpubManifest, storage: PagedStorage | undefined, ctx: AdapterContext): Promise<void> {
  const marks = storage ? new IntegerTable(storage) : new Map<bigint, bigint>();
  for await (const item of manifest.values()) {
    let current: ManifestItem = item, depth = 0, suffix = 0;
    while (current.fallback) {
      await ctx.cooperate();
      const mark = await marks.get(BigInt(current.ordinal)) ?? 0n;
      if (mark >= 2n) {
        suffix = Number(mark - 2n);
        // The original walk fails on its first excess edge, not at the end of
        // the cached suffix. Preserve that reported depth and error precedence.
        ctx.bound("depth", Math.min(depth + suffix, ctx.limits.depth + 1));
        break;
      }
      ctx.bound("depth", ++depth);
      if (mark === 1n) epubFailure(ctx, current.part, "Recursive EPUB fallback dependency");
      await marks.set(BigInt(current.ordinal), 1n);
      const next = await manifest.get(current.fallback);
      if (!next) return epubFailure(ctx, current.part, "Missing EPUB fallback item");
      current = next;
    }
    let remaining = depth + suffix;
    current = item;
    while ((await marks.get(BigInt(current.ordinal)) ?? 0n) < 2n) {
      await ctx.cooperate();
      await marks.set(BigInt(current.ordinal), BigInt(remaining) + 2n);
      if (!current.fallback) break;
      remaining--;
      current = (await manifest.get(current.fallback))!;
    }
  }
}
