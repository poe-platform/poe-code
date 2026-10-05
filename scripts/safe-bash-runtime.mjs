import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { constants } from "node:fs";
import * as fileSystem from "node:fs/promises";
import { assertSafeOutputDirectory } from "./guard-package-dist.mjs";

async function validateRuntime(entry) {
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e",
    'const runtime = await import(process.argv[1]); if (typeof runtime.safeBashMain !== "function") throw new Error("Missing Safe Bash entrypoint"); process.exit(0);', pathToFileURL(entry).href]);
}

// Keep generations outside dist: a build may remove dist before compiling.
// Never collect old generations here: a running shell may still import them.
export async function publishSafeBashRuntime(root, artifacts, { files = fileSystem, validate = validateRuntime } = {}) {
  const directory = path.join(root, ".cache/safe-bash-runtime");
  const pointer = path.join(directory, "current");
  const filenames = new Set(["package.json", ...artifacts]);
  if (!filenames.has("dist/safe-bash.js")) throw new Error("Missing Safe Bash runtime artifact.");
  for (const filename of filenames) {
    if (path.isAbsolute(filename) || filename.replaceAll("\\", "/").split("/").some(part => !part || part === "." || part === "..")) {
      throw new Error(`Invalid runtime artifact: ${filename}`);
    }
  }
  await assertSafeOutputDirectory(root, directory, files);
  await assertSafeOutputDirectory(root, pointer, files);
  await files.mkdir(directory, { recursive: true });
  const generation = await files.mkdtemp(path.join(directory, "runtime-"));
  try {
    for (const filename of filenames) {
      const source = path.join(root, filename);
      await assertSafeOutputDirectory(root, source, files);
      const target = path.join(generation, filename);
      await files.mkdir(path.dirname(target), { recursive: true });
      // Reflinks are independent copies, unlike hard links to mutable outputs.
      await files.copyFile(source, target, constants.COPYFILE_FICLONE);
    }
    await validate(path.join(generation, "dist/safe-bash.js"));
    const next = path.join(generation, "current");
    await files.writeFile(next, path.basename(generation));
    await files.rename(next, pointer);
  } catch (error) {
    await files.rm(generation, { recursive: true, force: true });
    throw error;
  }
}

export async function resolveSafeBashRuntime(root, files = fileSystem) {
  const directory = path.join(root, ".cache/safe-bash-runtime");
  let generation;
  try {
    generation = await files.readFile(path.join(directory, "current"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error("Safe Bash needs a completed local build. Run npm run build in this checkout.", { cause: error });
  }
  if (!generation.startsWith("runtime-") || path.basename(generation) !== generation || generation.includes("\\")) {
    throw new Error("Invalid Safe Bash runtime generation. Run npm run build in this checkout.");
  }
  return path.join(directory, generation, "dist/safe-bash.js");
}
