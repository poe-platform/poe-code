import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.includes("/consumer/node_modules/virtual-bash/dist/")) {
    if (!result.source) throw new Error("package load has no emitted source");
    await appendFile(process.env.PHASE2_CLOSURE, JSON.stringify({ url,
      sha256: createHash("sha256").update(result.source).digest("hex") }) + "\n");
  }
  return result;
}
