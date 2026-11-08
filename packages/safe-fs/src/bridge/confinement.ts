import { FsError, isFsError } from "../contracts/errors.js";
import type { FileSystem, FsOptions } from "../contracts/filesystem.js";
import { dirname } from "../contracts/virtual-path.js";
import { checkSignal } from "./values.js";

function denied(path: string): never {
  throw new FsError("EACCES", { syscall: "resolve", path, message: "path escapes the bridge cwd" });
}

function relativeComponents(root: string, path: string): string[] {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) denied(path);
  const boundary = root.split("/").filter(Boolean);
  const components = path.split("/").filter(Boolean);
  let index = 0;
  for (const component of boundary) {
    while (components[index] === ".") index++;
    if (components[index] !== component) denied(path);
    index++;
  }
  const relative = components.slice(index);
  let depth = 0;
  for (const component of relative) {
    if (component === ".") continue;
    if (component === "..") {
      if (depth === 0) denied(path);
      depth--;
    } else depth++;
  }
  if (path.endsWith("/")) relative.push(".");
  return relative;
}

export function assertBridgePath(root: string, path: string): void {
  if (root !== "/") relativeComponents(root, path);
}

async function assertCanonicalPath(
  fs: FileSystem,
  root: string,
  path: string,
  options: FsOptions
): Promise<void> {
  checkSignal(options.signal);
  const canonical = await fs.realpath(path, options);
  checkSignal(options.signal);
  assertBridgePath(root, canonical);
  if (canonical !== path) denied(path);
}

async function assertCanonicalOperand(
  fs: FileSystem,
  root: string,
  path: string,
  expected: string,
  options: FsOptions
): Promise<void> {
  let operand = path;
  let target = expected;
  while (true) {
    checkSignal(options.signal);
    try {
      const canonical = await fs.realpath(operand, options);
      checkSignal(options.signal);
      assertBridgePath(root, canonical);
      if (canonical !== target) denied(path);
      return;
    } catch (error) {
      checkSignal(options.signal);
      if (!isFsError(error) || error.code !== "ENOENT") throw error;
      let missing = false;
      try {
        await fs.lstat(operand, options);
      } catch (inspectionError) {
        checkSignal(options.signal);
        if (!isFsError(inspectionError) || inspectionError.code !== "ENOENT") throw inspectionError;
        missing = true;
      }
      checkSignal(options.signal);
      if (!missing || operand === root) denied(path);
      operand = dirname(operand);
      target = dirname(target);
      assertBridgePath(root, operand);
      assertBridgePath(root, target);
    }
  }
}

export async function checkedBridgePath(
  fs: FileSystem,
  root: string,
  path: string,
  options: FsOptions,
  followFinal: boolean
): Promise<string> {
  if (root === "/") return path;
  let pending = relativeComponents(root, path);
  let current = "";
  for (const component of root.split("/").filter(Boolean)) {
    current += `/${component}`;
    checkSignal(options.signal);
    try {
      const stat = await fs.lstat(current, options);
      checkSignal(options.signal);
      if (stat.type === "symlink") denied(current);
      if (stat.type !== "directory")
        throw new FsError("ENOTDIR", { syscall: "resolve", path: current });
    } catch (error) {
      checkSignal(options.signal);
      if (!isFsError(error) || error.code !== "ENOENT") throw error;
      if (current !== root) denied(path);
      if (pending.includes("..")) throw error;
      const parent = dirname(root);
      await assertCanonicalPath(fs, parent, parent, options);
      return path;
    }
  }
  await assertCanonicalPath(fs, root, root, options);
  let links = 0;
  let finalLink = false;
  let index = 0;
  while (index < pending.length) {
    const component = pending[index++]!;
    checkSignal(options.signal);
    if (component === ".") continue;
    if (component === "..") {
      if (current === root) denied(path);
      current = dirname(current);
      continue;
    }
    const candidate = `${current}/${component}`;
    let stat;
    try {
      stat = await fs.lstat(candidate, options);
    } catch (error) {
      checkSignal(options.signal);
      if (!isFsError(error) || error.code !== "ENOENT") throw error;
      if (pending.slice(index).includes("..")) throw error;
      await assertCanonicalPath(fs, root, current, options);
      const expected = [candidate, ...pending.slice(index)].join("/");
      await assertCanonicalOperand(fs, root, path, expected, options);
      return path;
    }
    checkSignal(options.signal);
    if (stat.type === "symlink" && (followFinal || index < pending.length)) {
      if (++links > 40) throw new FsError("ELOOP", { syscall: "resolve", path });
      if (typeof fs.readlink !== "function")
        throw new FsError("ENOTSUP", { syscall: "readlink", path: candidate });
      const target = await fs.readlink(candidate, options);
      checkSignal(options.signal);
      if (typeof target !== "string" || target.length === 0 || target.includes("\0"))
        denied(candidate);
      const absolute = target.startsWith("/") ? target : `${current}/${target}`;
      pending = [...relativeComponents(root, absolute), ...pending.slice(index)];
      index = 0;
      current = root;
      continue;
    }
    if (index < pending.length && stat.type !== "directory") {
      throw new FsError("ENOTDIR", { syscall: "resolve", path: candidate });
    }
    current = candidate;
    finalLink = stat.type === "symlink";
  }
  await assertCanonicalPath(fs, root, finalLink ? dirname(current) : current, options);
  await assertCanonicalOperand(
    fs,
    root,
    finalLink ? dirname(path) : path,
    finalLink ? dirname(current) : current,
    options
  );
  return path;
}
