import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.includes("/consumer/node_modules/virtual-bash/dist/")) {
    const source = result.source ?? await readFile(fileURLToPath(url));
    await appendFile(process.env.INDEPENDENT_LOADED_LOG, JSON.stringify({ url, format: result.format,
      sha256: createHash("sha256").update(source).digest("hex") }) + "\n");
  }
  return result;
}
