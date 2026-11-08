import { registerHooks } from "node:module";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const configuration = JSON.parse(readFileSync(process.env.WHICH_GUARD_MANIFEST, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const admission = url => {
  if (!url.startsWith("file:")) {
    if (!url.startsWith("node:")) throw new Error(`WHICH_GUARD_URL:${url}`);
    return;
  }
  const filename = realpathSync(fileURLToPath(url));
  const expected = configuration.hashes[filename];
  if (!expected) throw new Error(`WHICH_GUARD_UNLISTED:${filename}`);
  const actual = hash(readFileSync(filename));
  if (actual !== expected) throw new Error(`WHICH_GUARD_HASH:${filename}`);
  appendFileSync(path.join(configuration.logs, `${process.pid}.jsonl`), JSON.stringify({ filename, sha256: actual }) + "\n");
};
registerHooks({
  resolve(specifier, context, next) {
    if (configuration.sourceRoot && specifier.startsWith("file:")) {
      const requested = fileURLToPath(specifier);
      const prefix = path.join(configuration.sourceRoot, "dist") + path.sep;
      if (requested.startsWith(prefix) && requested.endsWith(".js")) {
        const source = path.join(configuration.sourceRoot, "src", requested.slice(prefix.length).replace(/\.js$/, ".ts"));
        if (!configuration.hashes[source]) throw new Error(`WHICH_GUARD_NO_SOURCE_BINDING:${source}`);
        return next(pathToFileURL(source).href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    admission(url);
    return next(url, context);
  }
});
