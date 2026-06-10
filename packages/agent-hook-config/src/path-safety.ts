import * as fs from "node:fs";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";

export function assertNoSymbolicLink(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;

  for (const segment of resolved.slice(parsed.root.length).split(path.sep)) {
    if (segment.length === 0) {
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
