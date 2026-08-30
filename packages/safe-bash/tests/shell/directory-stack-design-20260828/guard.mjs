import { registerHooks } from "node:module";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const configuration = JSON.parse(readFileSync(process.env.DIRSTACK_GUARD, "utf8"));
registerHooks({ load(url, context, next) {
  if (url.startsWith("file:")) {
    const filename = realpathSync(fileURLToPath(url));
    const expected = configuration.hashes[filename];
    if (!expected) throw new Error(`DIRSTACK_UNLISTED:${filename}`);
    const sha256 = createHash("sha256").update(readFileSync(filename)).digest("hex");
    if (sha256 !== expected) throw new Error(`DIRSTACK_CHANGED:${filename}`);
    appendFileSync(configuration.log, JSON.stringify({ filename, sha256 }) + "\n");
  } else if (!url.startsWith("node:")) throw new Error(`DIRSTACK_URL:${url}`);
  return next(url, context);
} });
