import type { CommandContext } from "../../contracts/command.js";
import { FsError } from "../../contracts/errors.js";
import { readBytes, type ByteSource } from "../../contracts/io.js";
import { assertCommandRequirements, type CommandFileSystemRequirement } from "../../contracts/command-requirements.js";
import { tryResolveMemoryDevicePath } from "@poe-code/safe-fs/core";
import { getRuntimeBackingFileSystem } from "../../fs/creation-mask.js";
import { pathOf } from "../internal.js";
import { inputRequirements } from "../portable-requirements.js";

export const grepRequirements: readonly CommandFileSystemRequirement[] = [
  ...inputRequirements,
  { id: "metadata", description: "Inspect recursive grep operands", capabilities: ["stat"] },
  { id: "directory", description: "Walk grep directories", capabilities: ["readdir", "realpath"] },
  { id: "pattern-file", description: "Read grep pattern files (-f)", capabilities: [], anyOf: [["streamingRead"], ["read"]] },
];

export const searchRequirements: readonly CommandFileSystemRequirement[] = [
  ...inputRequirements,
  { id: "metadata", description: "Inspect named search operands", capabilities: ["stat"] },
  { id: "pattern-file", description: "Read rg pattern files (-f)", capabilities: ["read"] },
  { id: "directory", description: "Walk directories, including --files", capabilities: ["stat", "readdir", "realpath"] },
  { id: "canonical", description: "Resolve followed directory links for loop detection", capabilities: ["realpath"] },
  { id: "ignore-file", description: "Read directory ignore files unless disabled", capabilities: ["read"] },
];

export const sedRequirements: readonly CommandFileSystemRequirement[] = [
  ...inputRequirements,
  { id: "script-file", description: "Read sed program files (-f)", capabilities: ["read"] },
  { id: "script-read", description: "Read files referenced by sed r instructions", capabilities: [], anyOf: [["streamingRead"], ["read"]] },
  { id: "script-output", description: "Truncate and append files referenced by sed w instructions", capabilities: ["write", "append"], mutates: true },
  { id: "in-place", description: "Inspect and conditionally rewrite retained files (-i)", capabilities: ["stat", "write", "retainedRead", "atomicFileMutation"], mutates: true },
  { id: "backup", description: "Conditionally write retained original bytes to backups (-iSUFFIX)", capabilities: ["write", "atomicFileMutation"], mutates: true },
];

export async function assertPathRequirements(
  context: CommandContext, requirements: readonly CommandFileSystemRequirement[], modes: readonly string[], paths: readonly string[],
): Promise<void> {
  if (!paths.length) return;
  assertCommandRequirements(context, requirements, modes);
  if (!context.fs.capabilitiesFor) return;
  const backing = getRuntimeBackingFileSystem(context.fs);
  if (backing !== undefined && backing.capabilitiesFor === undefined) {
    let allSafe = true;
    for (let i = 0; i < paths.length; i++) {
      if (tryResolveMemoryDevicePath(backing, pathOf(context, paths[i]!)) === undefined) {
        allSafe = false;
        break;
      }
    }
    if (allSafe) return;
  }
  for (const path of new Set(paths)) {
    try {
      const capabilities = await context.fs.capabilitiesFor(pathOf(context, path), { signal: context.signal });
      assertCommandRequirements(context, requirements, modes, capabilities);
    } catch (error) {
      context.signal.throwIfAborted();
      if (!["ENOENT", "ENOTDIR"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
}

export function requiredFileInput(
  context: CommandContext, requirements: readonly CommandFileSystemRequirement[], mode: string, file: string, maxBytes: number,
): ByteSource {
  if (maxBytes === Infinity) {
    const path = pathOf(context, file);
    const backing = getRuntimeBackingFileSystem(context.fs);
    if (
      backing !== undefined &&
      backing.capabilitiesFor === undefined &&
      path !== "/dev" &&
      !path.startsWith("/dev/") &&
      context.fs.readStream &&
      context.fs.capabilities.streamingRead !== false &&
      Object.getPrototypeOf(backing)?.constructor?.name === "MemoryFileSystem" &&
      !Object.prototype.hasOwnProperty.call(backing, "readStream")
    ) {
      assertCommandRequirements(context, requirements, [mode]);
      return context.fs.readStream(path, { signal: context.signal });
    }
  }
  return requiredFileInputSlow(context, requirements, mode, file, maxBytes);
}

async function* requiredFileInputSlow(
  context: CommandContext, requirements: readonly CommandFileSystemRequirement[], mode: string, file: string, maxBytes: number,
): ByteSource {
  assertCommandRequirements(context, requirements, [mode]);
  const path = pathOf(context, file);
  let capabilities = context.fs.capabilities;
  if (context.fs.capabilitiesFor) {
    const backing = getRuntimeBackingFileSystem(context.fs);
    if (backing === undefined || backing.capabilitiesFor !== undefined || tryResolveMemoryDevicePath(backing, path) === undefined) {
      capabilities = await context.fs.capabilitiesFor(path, { signal: context.signal });
      assertCommandRequirements(context, requirements, [mode], capabilities);
    }
  }
  if (context.fs.readStream && capabilities.streamingRead !== false && context.fs.capabilities.streamingRead !== false) {
    let emitted = false;
    let reading = true;
    let bytes = 0;
    try {
      for await (const chunk of readBytes(context.fs.readStream(path, { signal: context.signal }), context.signal)) {
        reading = false;
        if (chunk.byteLength > maxBytes - bytes) throw new FsError("EFBIG", { syscall: "read", path, message: "input file byte limit exceeded" });
        bytes += chunk.byteLength;
        if (chunk.byteLength) emitted = true;
        yield chunk;
        reading = true;
      }
      return;
    } catch (error) {
      context.signal.throwIfAborted();
      if (!reading || emitted || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
    }
  }
  if (capabilities.read !== false && context.fs.capabilities.read !== false) {
    yield await context.fs.readFile(path, { signal: context.signal, ...(Number.isFinite(maxBytes) ? { maxBytes } : {}) });
    return;
  }
  throw new FsError("ENOTSUP", { syscall: "readFile", path });
}
