import path from "node:path";
import type { GaslightFileSystem } from "./types.js";

const VARIABLE_NAME = "[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*";
const PLACEHOLDER = new RegExp(
  `\\\\(\\{\\{\\s*${VARIABLE_NAME}\\s*\\}\\})|\\{\\{\\s*(${VARIABLE_NAME})\\s*\\}\\}`,
  "g"
);
const FILE_INCLUDE = /\{\{file\s+['"]([^'"]+)['"]\s*\}\}/g;

async function resolveFileIncludes(
  value: string,
  cwd: string,
  fs: GaslightFileSystem
): Promise<string> {
  const matches = [...value.matchAll(FILE_INCLUDE)];
  let resolved = value;
  for (const match of matches) {
    const includedPath = match[1] as string;
    const absolutePath = path.resolve(cwd, includedPath);
    const relativePath = path.relative(cwd, absolutePath);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Gaslight file include resolves outside the project root: ${includedPath}`);
    }
    const content = await fs.readFile(absolutePath, "utf8");
    resolved = resolved.replace(match[0], content);
  }
  return resolved;
}

export async function resolveGaslightVars(
  vars: Record<string, string>,
  cwd: string,
  fs: GaslightFileSystem
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(vars).map(async ([key, value]) => [
        key,
        await resolveFileIncludes(value, cwd, fs)
      ])
    )
  );
}

export function interpolateGaslightVars(
  prompt: string,
  vars: Record<string, string>,
  context: string
): string {
  return prompt.replace(
    PLACEHOLDER,
    (_match, escaped: string | undefined, key: string | undefined) => {
      if (escaped !== undefined) return escaped;
      const name = key as string;
      if (!Object.prototype.hasOwnProperty.call(vars, name)) {
        throw new Error(`Missing gaslight variable "${name}" in ${context}.`);
      }
      return vars[name] as string;
    }
  );
}
