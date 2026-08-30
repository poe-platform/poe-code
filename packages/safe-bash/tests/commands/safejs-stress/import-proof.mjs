import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(process.env.SAFEJS_LOCAL_ROOT);
const privateRoot = process.env.SAFEJS_FORBIDDEN_ROOT;
const recorded = new Set();
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) {
      const path = realpathSync(fileURLToPath(url));
      if (privateRoot) assert(!path.startsWith(`${realpathSync(privateRoot)}/`), `Forbidden private import: ${path}`);
      if (path.includes("/packages/safejs/src/")) assert(path.startsWith(`${root}/src/`), `Wrong engine import: ${path}`);
      if ([join(root, "src/run.ts"), join(root, "src/interp/interpreter.ts")].includes(path) && !recorded.has(path)) {
        recorded.add(path);
        console.log(JSON.stringify({ actualEngineLoad: path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
      }
    }
    return nextLoad(url, context);
  },
});
