import type { CommandContext } from "../../contracts/command.js";
import { FsError } from "../../contracts/errors.js";
import { readBytes, type ByteSource } from "../../contracts/io.js";
import { assertCommandRequirements, type CommandFileSystemRequirement } from "../../contracts/command-requirements.js";
import { pathOf } from "../internal.js";
import { inputRequirements } from "../portable-requirements.js";

export const grepRequirements: readonly CommandFileSystemRequirement[] = [
  ...inputRequirements,
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
  { id: "in-place", description: "Inspect and rewrite named files (-i)", capabilities: ["stat", "write"], mutates: true },
  { id: "backup", description: "Copy original files to backup destinations (-iSUFFIX)", capabilities: ["copy"], mutates: true },
];

export async function assertPathRequirements(
  context: CommandContext, requirements: readonly CommandFileSystemRequirement[], modes: readonly string[], paths: readonly string[],
): Promise<void> {
  if (!paths.length) return;
  assertCommandRequirements(context, requirements, modes);
  if (!context.fs.capabilitiesFor) return;
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

export async function* requiredFileInput(
  context: CommandContext, requirements: readonly CommandFileSystemRequirement[], mode: string, file: string, maxBytes: number,
): ByteSource {
  assertCommandRequirements(context, requirements, [mode]);
  const path = pathOf(context, file);
  const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
  assertCommandRequirements(context, requirements, [mode], capabilities);
  if (context.fs.readStream && capabilities.streamingRead !== false && context.fs.capabilities.streamingRead !== false) {
    let emitted = false;
    let reading = true;
    try {
      for await (const chunk of readBytes(context.fs.readStream(path, { signal: context.signal }), context.signal)) {
        reading = false;
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
  if (capabilities.read === false || context.fs.capabilities.read === false) throw new FsError("ENOTSUP", { syscall: "readFile", path });
  yield await context.fs.readFile(path, { signal: context.signal, maxBytes });
}
