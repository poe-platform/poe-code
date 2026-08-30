import { posix } from "node:path";
export {
  assertPathWithin, isPathWithin, normalizePath, relativePath, resolvePath, validatePath
} from "./virtual-path.js";

export const posixPath = posix;
export const basename = posix.basename;
export const dirname = posix.dirname;
export const extname = posix.extname;
export const joinPath = posix.join;
export const isAbsolutePath = posix.isAbsolute;
