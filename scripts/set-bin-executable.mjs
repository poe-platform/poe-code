import path from "node:path";
import { chmod, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * `tsc` emits bin files with mode 0644, which strips the executable bit a
 * shebang needs once the package is published. (Bundlers like esbuild set the
 * bit themselves when the output starts with `#!`.) This restores mode 0755 on
 * every file a package declares in its `bin`, derived straight from the
 * manifest so packages stay declarative and adding a bin needs no extra wiring.
 *
 * Returns the bin targets it made executable, relative to the package.
 * Throws if a declared bin file is absent so a typo or missing build artifact
 * fails the build instead of shipping a broken binary.
 */
export async function setBinExecutable(packageDirectory, fileSystem = { chmod, readFile }) {
  const manifest = JSON.parse(
    await fileSystem.readFile(path.join(packageDirectory, "package.json"), "utf8")
  );
  const bin = manifest.bin;
  const targets =
    typeof bin === "string"
      ? [bin]
      : bin && typeof bin === "object"
        ? Object.values(bin).filter((value) => typeof value === "string")
        : [];

  for (const target of targets) {
    try {
      await fileSystem.chmod(path.join(packageDirectory, target), 0o755);
    } catch (error) {
      throw new Error(
        `Cannot make bin executable: ${manifest.name ?? packageDirectory} declares "${target}" but it is missing.`,
        { cause: error }
      );
    }
  }
  return targets;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changed = await setBinExecutable(process.cwd());
  for (const target of changed) {
    console.log(`chmod 0755 ${target}`);
  }
}
