import { assertCommandRequirements, type CommandFileSystemRequirement } from "../contracts/command-requirements.js";
import { dirname, FsError, type CommandContext } from "../contracts/index.js";
import { codeOf } from "./internal.js";

export const filesystemCommandRequirements = {
  mkdir: [
    { id: "directory", description: "Create explicit directories", capabilities: ["explicitDirectories", "mkdir"], mutates: true },
    { id: "parents", description: "Create parent directories (-p)", capabilities: ["explicitDirectories", "recursiveMkdir"], mutates: true },
  ],
  touch: [
    { id: "create", description: "Create a missing file exclusively", capabilities: ["stat", "exclusiveCreate"], mutates: true },
    { id: "existing", description: "Update existing file timestamps", capabilities: ["stat", "timestamps"], mutates: true },
    { id: "no-create", description: "Skip missing files (-c)", capabilities: ["stat"] },
  ],
  cp: [
    { id: "file", description: "Copy file contents", capabilities: ["stat", "realpath", "copy"], mutates: true },
    { id: "recursive", description: "Copy directory trees (-r/-R)", capabilities: ["stat", "realpath", "readdir", "explicitDirectories", "mkdir", "copy"], mutates: true },
    { id: "symlink", description: "Copy symbolic links without dereferencing", capabilities: ["stat", "realpath", "readlink", "symlinks"], mutates: true },
    { id: "replace", description: "Remove a destination before replacing it", capabilities: ["remove"], mutates: true },
    { id: "exclusive", description: "Exclusively copy after forced removal", capabilities: ["exclusiveCopy"], mutates: true },
  ],
  mv: [
    { id: "rename", description: "Rename files or directories", capabilities: ["stat", "rename"], mutates: true },
    { id: "cross-source", description: "Remove file sources after an existing cross-device transfer", capabilities: ["stat", "remove"], mutates: true },
    { id: "cross-directory-source", description: "Traverse and remove cross-device source directories", capabilities: ["stat", "readdir", "removeDirectory"], mutates: true },
    { id: "cross-link-source", description: "Inspect and remove cross-device source links", capabilities: ["stat", "readlink", "remove"], mutates: true },
    { id: "cross-file", description: "Publish file contents through the existing cross-device copy route", capabilities: ["stat", "copy"], mutates: true },
    { id: "cross-exclusive", description: "Publish a missing cross-device destination exclusively", capabilities: ["exclusiveCopy"], mutates: true },
    { id: "cross-directory", description: "Create missing cross-device destination directories", capabilities: ["mkdir"], mutates: true },
    { id: "cross-link", description: "Publish cross-device destination links", capabilities: ["symlinks"], mutates: true },
    { id: "cross-replace", description: "Remove entries replaced by a cross-device transfer", capabilities: ["remove"], mutates: true },
  ],
  rm: [
    { id: "file", description: "Remove file entries", capabilities: ["stat", "remove"], mutates: true },
    { id: "directory", description: "Remove empty directories (-d)", capabilities: ["stat", "removeDirectory"], mutates: true },
    { id: "recursive", description: "Remove directory trees (-r/-R)", capabilities: ["stat", "recursiveRemove"], mutates: true },
  ],
  rmdir: [
    { id: "directory", description: "Remove empty directories, including parents (-p)", capabilities: ["removeDirectory"], mutates: true },
  ],
  ln: [
    { id: "hard", description: "Create hard links", capabilities: ["stat", "hardlinks"], mutates: true },
    { id: "symbolic", description: "Create symbolic links (-s)", capabilities: ["stat", "symlinks"], mutates: true },
    { id: "replace", description: "Remove existing destinations (-f)", capabilities: ["remove"], mutates: true },
  ],
  readlink: [
    { id: "link", description: "Read symbolic link targets", capabilities: ["readlink"] },
    { id: "canonical", description: "Canonicalize paths (-f/-e)", capabilities: ["stat", "realpath"] },
  ],
  realpath: [
    { id: "canonical", description: "Canonicalize existing or missing paths", capabilities: ["stat", "realpath"] },
  ],
  ls: [
    { id: "entry", description: "Inspect individual directory entries", capabilities: ["stat"] },
    { id: "directory", description: "List directories, including recursive listings (-R)", capabilities: ["stat", "readdir", "realpath"] },
    { id: "link", description: "Show symbolic link targets in long listings (-l)", capabilities: ["readlink"] },
  ],
} satisfies Record<string, readonly CommandFileSystemRequirement[]>;

export async function admitFilesystemModes(
  context: CommandContext, command: keyof typeof filesystemCommandRequirements, modes: readonly string[], paths: readonly string[],
): Promise<void> {
  const requirements = filesystemCommandRequirements[command];
  for (const path of paths) {
    let candidate = path;
    while (true) {
      try {
        assertCommandRequirements(context, requirements, modes, context.fs.capabilities.readOnly === true ? { readOnly: true } : {});
        const capabilities = await context.fs.capabilitiesFor?.(candidate, { signal: context.signal }) ?? context.fs.capabilities;
        assertCommandRequirements(context, requirements, modes, capabilities);
        break;
      } catch (error) {
        context.signal.throwIfAborted();
        if (codeOf(error) === "ENOTSUP" || codeOf(error) === "EROFS") {
          throw new FsError(codeOf(error) === "EROFS" ? "EROFS" : "ENOTSUP", { syscall: command, path, cause: error });
        }
        if (codeOf(error) !== "ENOENT" || candidate === "/") throw error;
        candidate = dirname(candidate);
      }
    }
  }
}
