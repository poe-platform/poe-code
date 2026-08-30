import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fs.realpathSync(process.env.RUN_ROOT);
const product = fs.realpathSync(process.env.PRODUCT_ROOT);
const admitted = JSON.parse(fs.readFileSync(process.env.PRODUCT_INVENTORY, "utf8"));
export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  assert.ok(filename.startsWith(root + path.sep), `Outside admitted consumer: ${filename}`);
  assert.ok(!filename.endsWith(".ts") && !filename.endsWith(".mts"), "Product source fallback forbidden");
  const loaded = await nextLoad(url, context);
  if (filename.startsWith(path.join(product, "dist") + path.sep)) {
    const relative = path.relative(product, filename), expected = admitted[relative];
    assert.ok(expected?.kind === "file", `Unlisted product load: ${relative}`);
    const digest = createHash("sha256").update(typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source)).digest("hex");
    assert.equal(digest, expected.sha256, `Changed product load: ${relative}`);
    fs.appendFileSync(process.env.LOAD_LOG, JSON.stringify({ relative, sha256: digest }) + "\n");
  }
  return loaded;
}
