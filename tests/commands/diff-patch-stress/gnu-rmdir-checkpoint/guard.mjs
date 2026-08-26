import assert from "node:assert/strict";
import { appendFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(process.cwd());
const expected = realpathSync(process.env.CHECKPOINT_SNAPSHOT);
assert.equal(root, expected, "checkpoint process has the wrong cwd");
const log = join(process.env.CHECKPOINT_IMPORT_LOG, `${process.pid}.jsonl`);
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) {
      const path = realpathSync(fileURLToPath(url));
      const local = relative(root, path);
      assert(local !== ".." && !local.startsWith("../") && !isAbsolute(local), `module escaped immutable snapshot: ${url}`);
      appendFileSync(log, `${JSON.stringify({ pid: process.pid, path: local })}\n`);
    } else assert(url.startsWith("node:") || url.startsWith("data:"), `unexpected module protocol: ${url}`);
    return nextLoad(url, context);
  },
});
