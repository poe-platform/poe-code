import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const candidate = realpathSync(process.env.COLUMN_CANDIDATE);
const probe = realpathSync(process.env.COLUMN_PROBE);
registerHooks({
  load(url, context, next) {
    if (url.startsWith("node:")) return next(url, context);
    const path = realpathSync(fileURLToPath(url));
    assert(path === probe || path.startsWith(`${candidate}/dist/`), `Outside frozen runtime binding: ${path}`);
    const result = next(url, context);
    appendFileSync(process.env.COLUMN_IMPORTS, `${JSON.stringify({ url, path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })}\n`);
    return result;
  },
});
