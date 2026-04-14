import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function isDirectExecution(
  moduleUrl: string,
  argv: string[]
): Promise<boolean> {
  const entryPoint = argv[1];

  if (typeof entryPoint !== "string" || entryPoint.length === 0) {
    return false;
  }

  try {
    const modulePath = fileURLToPath(moduleUrl);
    const [resolvedEntryPoint, resolvedModulePath] = await Promise.all([
      realpath(path.resolve(entryPoint)),
      realpath(modulePath)
    ]);

    return resolvedEntryPoint === resolvedModulePath;
  } catch {
    return false;
  }
}
