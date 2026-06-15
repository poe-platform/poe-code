import * as fs from "node:fs";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";

export function assertNoSymbolicLink(targetPath: string, opts?: { root?: string }): void {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  const checkRoot = opts?.root === undefined ? parsed.root : path.resolve(opts.root);
  const relative = path.relative(checkRoot, resolved);
  const outsideRoot =
    opts?.root !== undefined && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
  let current = outsideRoot ? parsed.root : checkRoot;
  const segments = outsideRoot
    ? resolved.slice(parsed.root.length).split(path.sep)
    : relative.split(path.sep);

  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Hook path must not traverse a symbolic link: ${current}`);
      }
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
  }
}
