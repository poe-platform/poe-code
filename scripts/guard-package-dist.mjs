import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function assertSafeOutputDirectory(
  packageDirectory,
  outputDirectory = path.join(packageDirectory, "dist"),
  fileSystem = { realpath },
) {
  let existingOutputDirectory = outputDirectory;
  let canonicalOutputDirectory;

  while (true) {
    try {
      canonicalOutputDirectory = await fileSystem.realpath(existingOutputDirectory);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      const parentDirectory = path.dirname(existingOutputDirectory);
      if (parentDirectory === existingOutputDirectory) {
        throw error;
      }
      existingOutputDirectory = parentDirectory;
    }
  }

  const canonicalPackageDirectory = await fileSystem.realpath(packageDirectory);
  const relativeOutputDirectory = path.relative(canonicalPackageDirectory, canonicalOutputDirectory);

  if (
    relativeOutputDirectory === ".." ||
    relativeOutputDirectory.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutputDirectory)
  ) {
    throw new Error("The output directory must remain inside the package directory.");
  }
}

export async function assertSafeBundleOutputs(rootDirectory, fileSystem = { realpath }) {
  await Promise.all([
    assertSafeOutputDirectory(rootDirectory, path.join(rootDirectory, "dist"), fileSystem),
    assertSafeOutputDirectory(
      rootDirectory,
      path.join(rootDirectory, "dist", "providers"),
      fileSystem,
    ),
    assertSafeOutputDirectory(
      rootDirectory,
      path.join(rootDirectory, "dist", "templates", "skill"),
      fileSystem,
    ),
    assertSafeOutputDirectory(
      path.join(rootDirectory, "packages", "memory"),
      path.join(rootDirectory, "packages", "memory", "dist"),
      fileSystem,
    ),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await assertSafeOutputDirectory(process.cwd());
}
