import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export async function load(url, context, nextLoad) {
  if (url.startsWith("node:")) return nextLoad(url, context);
  if (!url.startsWith("file:")) throw new Error(`Non-file import refused: ${url}`);
  const filename = realpathSync(fileURLToPath(url));
  const roots = JSON.parse(process.env.INDEPENDENT_ALLOWED_ROOTS);
  if (!roots.some(root => filename.startsWith(`${root}/`))) throw new Error(`Outside authenticated roots: ${filename}`);
  const bytes = readFileSync(filename);
  const loaded = await nextLoad(url, context);
  const loadedBytes = loaded.source === null || loaded.source === undefined ? bytes : Buffer.from(loaded.source);
  if (!bytes.equals(loadedBytes)) throw new Error(`Loader byte mismatch: ${filename}`);
  appendFileSync(process.env.INDEPENDENT_LOAD_RECEIPT, JSON.stringify({ filename, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }) + "\n");
  return loaded;
}
