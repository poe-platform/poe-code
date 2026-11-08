import { registerHooks } from "node:module";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const input = JSON.parse(readFileSync(process.env.COMBINED_GUARD, "utf8"));
registerHooks({ load(url, context, next) {
  if (url.startsWith("file:")) {
    const filename = realpathSync(fileURLToPath(url));
    if (!Object.hasOwn(input.hashes, filename)) throw new Error(`COMBINED_UNLISTED:${filename}`);
    const sha256 = createHash("sha256").update(readFileSync(filename)).digest("hex");
    if (sha256 !== input.hashes[filename]) throw new Error(`COMBINED_CHANGED:${filename}`);
    appendFileSync(input.log, JSON.stringify({ filename, sha256 }) + "\n");
  } else if (!url.startsWith("node:")) throw new Error(`COMBINED_URL:${url}`);
  return next(url, context);
} });
