import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TokenVerifier } from "./auth.js";

function isWindowsAbsolutePath(value: string): boolean {
  if (value.length < 3) {
    return false;
  }

  const drive = value.charCodeAt(0);
  const separator = value[2];
  const isLetter =
    (drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122);

  return isLetter && value[1] === ":" && (separator === "\\" || separator === "/");
}

function resolveModuleSpecifier(modulePath: string, cwd: string): string {
  if (modulePath.startsWith("file:")) {
    return modulePath;
  }

  if (
    modulePath.startsWith(".")
    || modulePath.startsWith("/")
    || isWindowsAbsolutePath(modulePath)
  ) {
    const resolvedPath = path.isAbsolute(modulePath)
      ? modulePath
      : path.resolve(cwd, modulePath);
    return pathToFileURL(resolvedPath).href;
  }

  return modulePath;
}

function isTokenVerifier(value: unknown): value is TokenVerifier {
  if (
    typeof value !== "object"
    || value === null
    || !Object.prototype.hasOwnProperty.call(value, "verify")
  ) {
    return false;
  }

  return typeof (value as { verify?: unknown }).verify === "function";
}

export async function loadOAuthVerifier(input: {
  modulePath: string;
  exportName?: string;
  cwd?: string;
}): Promise<TokenVerifier> {
  const exportName = input.exportName ?? "default";
  const moduleSpecifier = resolveModuleSpecifier(
    input.modulePath,
    input.cwd ?? process.cwd()
  );
  const loadedModule = (await import(moduleSpecifier)) as Record<string, unknown>;
  const verifier = loadedModule[exportName];

  if (!isTokenVerifier(verifier)) {
    throw new Error(
      `OAuth verifier export "${exportName}" from "${input.modulePath}" must be an object with a verify() method.`
    );
  }

  return verifier;
}
