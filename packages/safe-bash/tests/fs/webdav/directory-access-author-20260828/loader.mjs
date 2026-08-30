import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.realpathSync(process.env.CONSUMER_ROOT);
const packageRoot = path.join(root, "node_modules/virtual-bash");
const inventory = JSON.parse(fs.readFileSync(process.env.PACKAGE_INVENTORY, "utf8"));
export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  if (!filename.startsWith(root + path.sep)) throw new Error(`Forbidden outside consumer load: ${filename}`);
  const result = await nextLoad(url, context);
  if (filename.startsWith(packageRoot + path.sep)) {
    const relative = path.relative(packageRoot, filename);
    const expected = inventory[relative];
    assert.ok(expected, `Unlisted product load: ${relative}`);
    const sha256 = createHash("sha256").update(typeof result.source === "string" ? result.source : Buffer.from(result.source)).digest("hex");
    assert.equal(sha256, expected.sha256, `Changed product load: ${relative}`);
    fs.appendFileSync(process.env.LOAD_LOG, JSON.stringify({ relative, sha256 }) + "\n");
  }
  return result;
}
