import { registerHooks } from "node:module";
import { appendFileSync, readFileSync, realpathSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const configuration = JSON.parse(readFileSync(process.env.STAGE2_GUARD_MANIFEST, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const checkedMirrors = new Set();
function mirrorHash(filename) {
  const base = configuration.mirrorBase + path.sep;
  if (!filename.startsWith(base)) return undefined;
  const parts = filename.slice(base.length).split(path.sep);
  if (!/^\.consumer-[a-zA-Z0-9]+$/.test(parts[0]) || parts[1] !== "node_modules" || parts[2] !== "virtual-bash") return undefined;
  const root = path.join(configuration.mirrorBase, ...parts.slice(0, 3));
  if (!checkedMirrors.has(root)) {
    const found = {};
    const walk = folder => {
      for (const name of readdirSync(folder).sort()) {
        const target = path.join(folder, name);
        const stat = lstatSync(target);
        if (stat.isSymbolicLink()) throw new Error("MIRROR_SYMLINK");
        if (stat.isDirectory()) walk(target);
        else if (stat.isFile()) found[path.relative(root, target)] = hash(readFileSync(target));
        else throw new Error("MIRROR_NONREGULAR");
      }
    };
    walk(root);
    if (JSON.stringify(Object.entries(found).sort()) !== JSON.stringify(Object.entries(configuration.mirrorFiles).sort())) throw new Error("MIRROR_CLOSURE_MISMATCH");
    checkedMirrors.add(root);
  }
  return configuration.mirrorFiles[parts.slice(3).join("/")];
}
registerHooks({ load(url, context, next) {
  if (url.startsWith("file:")) {
    const filename = realpathSync(fileURLToPath(url));
    const expected = configuration.hashes[filename] ?? mirrorHash(filename);
    if (!expected) throw new Error(`STAGE2_GUARD_UNLISTED:${filename}`);
    const actual = hash(readFileSync(filename));
    if (actual !== expected) throw new Error(`STAGE2_GUARD_HASH:${filename}`);
    appendFileSync(path.join(configuration.logs, `${process.pid}.jsonl`), JSON.stringify({ filename, sha256: actual,
      dynamicAuthenticatedMirror: !configuration.hashes[filename] }) + "\n");
  } else if (!url.startsWith("node:")) throw new Error(`STAGE2_GUARD_URL:${url}`);
  return next(url, context);
} });
