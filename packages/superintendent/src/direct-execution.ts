import { posixPath as path, type FileSystem } from "@poe-code/safe-fs";
import { createDefaultFileSystem, defaultCwd } from "#superintendent-filesystem";

export async function isDirectExecution(
  moduleUrl: string,
  argv: string[],
  fs?: FileSystem
): Promise<boolean> {
  const entryPoint = argv[1];
  if (typeof entryPoint !== "string" || entryPoint.length === 0) return false;

  try {
    const url = new URL(moduleUrl);
    if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) return false;
    if (url.pathname.toLowerCase().includes("%2f")) return false;
    const modulePath = decodeURIComponent(url.pathname);
    const provider = fs ?? createDefaultFileSystem();
    const [resolvedEntryPoint, resolvedModulePath] = await Promise.all([
      provider.realpath(path.resolve(defaultCwd(), entryPoint)),
      provider.realpath(modulePath)
    ]);
    return resolvedEntryPoint === resolvedModulePath;
  } catch {
    return false;
  }
}
