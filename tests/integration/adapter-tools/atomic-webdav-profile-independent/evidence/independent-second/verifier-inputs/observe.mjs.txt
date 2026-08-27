import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const log = process.env.INDEPENDENT_LOAD_LOG;
if (!log) throw new Error("explicit independent load log required");
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    appendFileSync(log, `${JSON.stringify({ kind: "resolve", specifier, parentURL: context.parentURL, url: result.url })}\n`);
    return result;
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith("file:")) {
      const path = realpathSync(fileURLToPath(url));
      appendFileSync(log, `${JSON.stringify({ kind: "load", url, path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })}\n`);
    }
    return result;
  },
});
