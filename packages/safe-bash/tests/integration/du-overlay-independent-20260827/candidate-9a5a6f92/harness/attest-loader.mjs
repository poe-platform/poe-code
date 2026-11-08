import { createHash } from "node:crypto";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const logPath = process.env.DU_OVERLAY_ATTEST_LOG;
const expectedRoot = process.env.DU_OVERLAY_EXPECTED_MODULE_ROOT
  ? realpathSync(process.env.DU_OVERLAY_EXPECTED_MODULE_ROOT)
  : undefined;

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (!url.startsWith("file:")) return loaded;
  const path = fileURLToPath(url);
  if (expectedRoot && path.includes("/dist/") && !(path === expectedRoot || path.startsWith(`${expectedRoot}/`))) {
    throw new Error(`dist module load escaped authenticated package root: ${path}`);
  }
  if (logPath && (path.includes("/dist/") || path.endsWith("verify-original.mjs") || path.endsWith("verify-refined-v2.mjs"))) {
    const source = loaded.source === null || loaded.source === undefined
      ? undefined
      : Buffer.isBuffer(loaded.source) || loaded.source instanceof Uint8Array
        ? Buffer.from(loaded.source)
        : Buffer.from(String(loaded.source));
    appendFileSync(logPath, `${JSON.stringify({
      url,
      path,
      format: loaded.format,
      sourceBytes: source?.byteLength,
      sourceSha256: source && createHash("sha256").update(source).digest("hex"),
    })}\n`);
  }
  return loaded;
}
