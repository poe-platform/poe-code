import { posixPath } from "../../contracts/path.js";
import type { SafeJsModule, SafeJsRuntime } from "../safejs/types.js";

export function createNodePathModule<Budget>(runtime: SafeJsRuntime<Budget>, cwd: string): SafeJsModule {
  const resolve = (...paths: string[]): string => {
    for (const path of paths) if (typeof path !== "string") throw new TypeError("path must be a string");
    let joined = "";
    for (let index = paths.length - 1; index >= -1; index--) {
      const path = index < 0 ? cwd : paths[index]!;
      if (!path) continue;
      joined = `${path}/${joined}`;
      if (path.startsWith("/")) break;
    }
    const normalized = posixPath.join(joined);
    return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  };
  const path: SafeJsModule = {
    ...Object.fromEntries(Object.entries(posixPath).map(([name, operation]) => [name, runtime.declareHostOperation(operation, "read-side-effect")])),
    normalize: runtime.declareHostOperation((value: string) => {
      if (typeof value !== "string") throw new TypeError("path must be a string");
      return posixPath.join(value);
    }, "read-side-effect"),
    resolve: runtime.declareHostOperation(resolve, "read-side-effect"),
    relative: runtime.declareHostOperation((from: string, to: string) => {
      const source = resolve(from).split("/").filter(Boolean);
      const target = resolve(to).split("/").filter(Boolean);
      let common = 0;
      while (common < source.length && common < target.length && source[common] === target[common]) common++;
      return [...Array<string>(source.length - common).fill(".."), ...target.slice(common)].join("/");
    }, "read-side-effect"),
    sep: "/", delimiter: ":",
  };
  return { ...path, posix: path };
}
