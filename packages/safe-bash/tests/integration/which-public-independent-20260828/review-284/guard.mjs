import { registerHooks } from "node:module";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const configuration = JSON.parse(readFileSync(process.env.PUBLIC_WHICH_MANIFEST, "utf8"));
registerHooks({ load(url, context, next) {
  if (url.startsWith("file:")) {
    const filename = realpathSync(fileURLToPath(url));
    const expected = configuration.hashes[filename];
    if (!expected) throw new Error(`PUBLIC_WHICH_UNLISTED:${filename}`);
    const actual = createHash("sha256").update(readFileSync(filename)).digest("hex");
    if (actual !== expected) throw new Error(`PUBLIC_WHICH_CHANGED:${filename}`);
    appendFileSync(path.join(configuration.logs, `${process.pid}.jsonl`), JSON.stringify({ filename, sha256: actual }) + "\n");
  } else if (!url.startsWith("node:")) throw new Error(`PUBLIC_WHICH_URL:${url}`);
  return next(url, context);
} });
