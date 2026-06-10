import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import type { FileSystem } from "./types.js";

export interface DiscoveredBase {
  content: string;
  filePath: string;
}

export async function findBase(
  name: string,
  bases: string[],
  fs: FileSystem
): Promise<DiscoveredBase> {
  const checkedPaths: string[] = [];

  for (const basePath of bases) {
    for (const extension of [".md", ".yaml", ".yml", ".json"]) {
      const filePath = path.join(basePath, `${name}${extension}`);
      const relativePath = path.relative(path.resolve(basePath), path.resolve(filePath));

      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error("Base name must remain inside configured base directories.");
      }

      checkedPaths.push(filePath);

      try {
        return {
          content: await fs.readFile(filePath, "utf8"),
          filePath
        };
      } catch (error) {
        if (hasOwnErrorCode(error, "ENOENT")) {
          continue;
        }

        throw error;
      }
    }
  }

  throw new Error(`Base "${name}" not found.\nChecked paths:\n- ${checkedPaths.join("\n- ")}`);
}
