import { existsSync } from "node:fs";
import path from "node:path";

export function findProjectRoot(from: string = process.cwd()): string | undefined {
  let current = from === process.cwd() ? process.cwd() : path.resolve(from);

  while (true) {
    if (existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}
