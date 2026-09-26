import { basename, dirname, extname, isAbsolutePath, joinPath, relativePath, resolvePath } from "@poe-code/safe-fs/core";
import { hostCwd } from "#safe-js-platform";
export { basename, dirname, extname, isAbsolutePath as isAbsolute, joinPath as join };
export const sep = "/";
export function resolve(...paths: string[]): string { return resolvePath(hostCwd(), ...paths); }
export function relative(from: string, to: string): string { return relativePath(resolve(from), resolve(to)); }
export default { basename, dirname, extname, isAbsolute: isAbsolutePath, join: joinPath, relative, resolve, sep };

export function pathToFileURL(path: string): URL {
  return new URL("file://" + resolve(path).split("/").map(segment => encodeURIComponent(segment)).join("/"));
}
