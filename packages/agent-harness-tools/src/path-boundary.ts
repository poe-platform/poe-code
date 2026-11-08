import { path } from "./portable-path.js";

export function assertContainedPath(rootPath: string, candidatePath: string, message: string): void {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(message);
  }
}
