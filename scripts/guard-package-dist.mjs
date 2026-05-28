import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function assertSafeDistDirectory(packageDirectory, fileSystem = { realpath }) {
  const distDirectory = path.join(packageDirectory, "dist");
  let canonicalDistDirectory;

  try {
    canonicalDistDirectory = await fileSystem.realpath(distDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const canonicalPackageDirectory = await fileSystem.realpath(packageDirectory);
  const relativeDistDirectory = path.relative(canonicalPackageDirectory, canonicalDistDirectory);

  if (
    relativeDistDirectory === ".." ||
    relativeDistDirectory.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDistDirectory)
  ) {
    throw new Error("The dist directory must remain inside the package directory.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await assertSafeDistDirectory(process.cwd());
}
