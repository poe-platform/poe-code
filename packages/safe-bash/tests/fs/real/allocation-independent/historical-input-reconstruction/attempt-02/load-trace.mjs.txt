import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith("file:")) {
    const source = result.source;
    if (source !== null && source !== undefined) {
      appendFileSync(process.env.ALLOCATION_LOAD_TRACE, JSON.stringify({ path: fileURLToPath(url),
        format: result.format, sha256: createHash("sha256").update(source).digest("hex") }) + "\n");
    }
  }
  return result;
}
