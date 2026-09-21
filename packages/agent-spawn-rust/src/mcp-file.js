import fsPromises from "node:fs/promises";
import path from "node:path";
import { native } from "./native.js";
function hasErrorCode(error, code) {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
async function assertSafePath(cwd, target, fs) {
  const root = path.resolve(cwd),
    relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("MCP config path must stay inside the workspace.");
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error("MCP config path must not contain symbolic links.");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return;
      throw error;
    }
  }
}
export function mergeMcpFileContent(existing, addition) {
  let parsed = {};
  if (existing !== undefined && existing.trim().length > 0) {
    try {
      parsed = JSON.parse(existing);
    } catch (error) {
      throw new Error("Unable to parse existing MCP config JSON.", { cause: error });
    }
  }
  return (
    JSON.stringify(
      native.spawnMergeMcp(JSON.stringify(parsed), JSON.stringify(addition)),
      null,
      2
    ) + "\n"
  );
}
export async function applyMcpFile(spec, servers, cwd, fs = fsPromises) {
  const target = path.resolve(cwd, spec.relativePath);
  await assertSafePath(cwd, target, fs);
  let existing;
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await assertSafePath(cwd, target, fs);
  await fs.writeFile(target, mergeMcpFileContent(existing, spec.content(servers)), "utf8");
  return async () => {
    await assertSafePath(cwd, target, fs);
    if (existing === undefined) await fs.rm(target, { force: true });
    else await fs.writeFile(target, existing, "utf8");
  };
}
