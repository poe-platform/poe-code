import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const log = process.env.ATOMIC_PROFILE_LOAD_LOG;
const root = process.env.ATOMIC_PROFILE_LOAD_ROOT;
if (!log || !root) throw new Error("explicit load log and isolated root required");
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith("file:")) {
      const path = realpathSync(fileURLToPath(url));
      if (path.startsWith(`${root}/`)) {
        appendFileSync(log, `${JSON.stringify({ path: path.slice(root.length + 1), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })}\n`);
      }
    }
    return result;
  },
});
