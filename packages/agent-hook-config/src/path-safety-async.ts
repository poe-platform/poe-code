import { posixPath as path } from "@poe-code/safe-fs";
import { hasOwnErrorCode } from "./error-codes.js";
import { type HookOperations } from "./filesystem.js";

export async function assertNoSymbolicLink(targetPath: string, opts: { root?: string } | undefined, io: HookOperations): Promise<void> {
  const resolved = path.resolve(targetPath);
  const checkRoot = opts?.root === undefined ? "/" : path.resolve(opts.root);
  const relative = path.relative(checkRoot, resolved);
  const outsideRoot =
    opts?.root !== undefined && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
  let current = outsideRoot ? "/" : checkRoot;
  const segments = outsideRoot
    ? resolved.slice("/".length).split(path.sep)
    : relative.split(path.sep);

  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    current = path.join(current, segment);
    try {
      if ((await io.lstat(current)).isSymbolicLink()) {
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
