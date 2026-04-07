import path from "node:path";
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
      checkedPaths.push(filePath);

      try {
        return {
          content: await fs.readFile(filePath, "utf8"),
          filePath
        };
      } catch (error) {
        if (hasCode(error, "ENOENT")) {
          continue;
        }

        throw error;
      }
    }
  }

  throw new Error(`Base "${name}" not found.\nChecked paths:\n- ${checkedPaths.join("\n- ")}`);
}

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
